import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { 
  ArrowUpRight, ArrowDownRight, Percent, 
  Calendar, Download, Clock, Sparkles
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

const toStandardDate = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const clean = raw.trim().split('T')[0];
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    return clean;
  }
  if (raw && typeof raw.toDate === 'function') {
    try { return format(raw.toDate(), 'yyyy-MM-dd'); } catch { return ''; }
  }
  return '';
};

export default function FinanceReport({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  const [transactions, setTransactions] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);

  // ວັນທີເລີ່ມຕົ້ນ ແລະ ສິ້ນສຸດ (Default: ເດືອນປັດຈຸບັນ)
  const [startDate, setStartDate] = useState<string>(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'this_month' | 'last_month' | 'all'>('this_month');

  // 1. ດຶງຂໍ້ມູນ Real-time ຈາກ Firestore
  useEffect(() => {
    const unsubT = onSnapshot(collection(db, 'transactions'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === currentBranch));
    }, err => handleFirestoreError(err, OperationType.LIST, 'transactions'));

    const unsubS = onSnapshot(collection(db, 'supplierPrices'), snap => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'supplierPrices'));

    return () => {
      unsubT();
      unsubS();
    };
  }, [currentBranch]);

  // ປ່ຽນ Preset ວັນທີ
  const handleDatePreset = (mode: 'today' | 'this_month' | 'last_month' | 'all') => {
    const now = new Date();
    setDateFilterMode(mode);
    if (mode === 'today') {
      const todayStr = format(now, 'yyyy-MM-dd');
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (mode === 'this_month') {
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    } else if (mode === 'last_month') {
      const prev = subMonths(now, 1);
      setStartDate(format(startOfMonth(prev), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(prev), 'yyyy-MM-dd'));
    } else if (mode === 'all') {
      setStartDate('2024-01-01');
      setEndDate(format(now, 'yyyy-MM-dd'));
    }
  };

  // 2. 🌟 ຄິດໄລ່ຕົວເລກການເງິນ (ຕັດເງິນປັນຜົນອອກຈາກ OPEX 100%)
  const reportData = useMemo(() => {
    let totalRevenue = 0;
    let totalCogs = 0;
    let totalOpex = 0;
    let totalDividends = 0; // ແຍກເງິນປັນຜົນຕ່າງຫາກ ບໍ່ເອົາມາປົນກັບ OPEX
    let totalReserveStock = 0;

    let cashRevenue = 0;
    let cashExpense = 0;
    let onepayRevenue = 0;
    let onepayExpense = 0;
    let ldbRevenue = 0;
    let ldbExpense = 0;

    let filteredTxCount = 0;

    // ດຶງຍອດ COGS ຈາກ Supplier ຕາມວັນທີ
    supplierPrices.forEach(sp => {
      const spDate = toStandardDate(sp.date || sp.createdAt);
      if (spDate >= startDate && spDate <= endDate) {
        const totalVal = sp.totalPriceLAK !== undefined
          ? Number(sp.totalPriceLAK || 0)
          : (Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);
        totalCogs += totalVal;
      }
    });

    // ດຶງຍອດ Transactions
    transactions.forEach(tx => {
      const txDate = toStandardDate(tx.date || tx.createdAt);
      if (txDate >= startDate && txDate <= endDate) {
        filteredTxCount++;
        const amt = Number(tx.amount || 0);
        const type = String(tx.type || '').toLowerCase();
        const cat = String(tx.category || '').toLowerCase();
        const method = String(tx.paymentMethod || 'Cash').toLowerCase();

        // 🌟 ກວດສອບວ່າແມ່ນ ເງິນປັນຜົນ ຫຼື ໂອນເຂົ້າ Stock ບໍ່
        const isDividend = type === 'dividend' || cat === 'dividend' || cat === 'dividends' || String(tx.remark || '').includes('ປັນຜົນ');
        const isReserve = type === 'reserve_transfer' || cat === 'stock_reserve' || String(tx.remark || '').includes('stock');

        if (isDividend) {
          totalDividends += amt; // ເກັບໄວ້ສະແດງຕ່າງຫາກ ບໍ່ໄລ່ເປັນ OPEX
        } else if (isReserve) {
          totalReserveStock += amt;
        } else if (type === 'income' || cat === 'sales') {
          totalRevenue += amt;
          if (method.includes('onepay')) onepayRevenue += amt;
          else if (method.includes('ldb')) ldbRevenue += amt;
          else cashRevenue += amt;
        } else if (type === 'expense') {
          // 🌟 ສະເພາະລາຍຈ່າຍດຳເນີນງານແທ້ໆເທົ່ານັ້ນ
          totalOpex += amt;
          if (method.includes('onepay')) onepayExpense += amt;
          else if (method.includes('ldb')) ldbExpense += amt;
          else cashExpense += amt;
        }
      }
    });

    // ສູດກຳໄລດຳເນີນງານທີ່ແທ້ຈິງ:
    const grossProfit = totalRevenue - totalCogs;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    
    // 🌟 Net Profit ດຳເນີນງານຕົວຈິງ = ກຳໄລຂັ້ນຕົ້ນ - ລາຍຈ່າຍ OPEX (ບໍ່ຖືກຫັກປັນຜົນ!)
    const netProfit = grossProfit - totalOpex;
    const roi = (totalCogs + totalOpex) > 0 ? (netProfit / (totalCogs + totalOpex)) * 100 : 0;

    // ຍອດເງິນສົດດຳເນີນງານ
    const netCash = cashRevenue - cashExpense;
    const netOnepay = onepayRevenue - onepayExpense;
    const netLdb = ldbRevenue - ldbExpense;

    return {
      totalRevenue,
      totalCogs,
      totalOpex,
      totalDividends,
      totalReserveStock,
      grossProfit,
      grossMargin,
      netProfit,
      roi,
      netCash,
      netOnepay,
      netLdb,
      filteredTxCount
    };
  }, [transactions, supplierPrices, startDate, endDate]);

  const handleExportExcel = () => {
    const headers = ['Metric', 'Amount (LAK)'];
    const rows = [
      ['Total Revenue', reportData.totalRevenue],
      ['COGS (Purchasing)', reportData.totalCogs],
      ['Gross Profit', reportData.grossProfit],
      ['Gross Margin %', `${reportData.grossMargin.toFixed(1)}%`],
      ['Operating Expenses (OPEX)', reportData.totalOpex],
      ['Net Operating Profit', reportData.netProfit],
      ['Dividends Settled', reportData.totalDividends],
      ['Net Cash', reportData.netCash],
      ['Net BCEL OnePay', reportData.netOnepay],
      ['Net LDB Bank', reportData.netLdb]
    ];
    const ws = utils.aoa_to_sheet([headers, ...rows]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `FinanceReport_${startDate}_${endDate}`);
    writeFile(wb, `FinanceReport_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div className="space-y-6">

      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ບົດລາຍງານການເງິນ & ວິເຄາະທຸລະກິດ' : 'Financial Statement & Business Analytics'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                {selectedBranch === 'branch_1' ? 'ສາຂາ 1' : 'ສາຂາ 2'}
              </span>
            </div>
            <p className="text-[10.5px] text-slate-400 font-bold uppercase mt-0.5">
              {startDate} ➔ {endDate} ({reportData.filteredTxCount} transactions)
            </p>
          </div>
        </div>

        <button
          onClick={handleExportExcel}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer self-start lg:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Excel Export</span>
        </button>
      </div>

      {/* Date Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-3 p-4 bg-white dark:bg-[#073069] rounded-2xl border border-slate-200/80 dark:border-white/10">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs">
            <span className="text-slate-400 font-bold text-[10px]">ເລີ່ມ:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-transparent font-bold outline-none cursor-pointer text-slate-800 dark:text-white"
            />
          </div>
          <span className="text-slate-400 font-bold">➔</span>
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs">
            <span className="text-slate-400 font-bold text-[10px]">ຮອດ:</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-transparent font-bold outline-none cursor-pointer text-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl text-xs font-bold w-full sm:w-auto justify-between">
          <button
            onClick={() => handleDatePreset('today')}
            className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${dateFilterMode === 'today' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
          >
            ມື້ນີ້
          </button>
          <button
            onClick={() => handleDatePreset('this_month')}
            className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${dateFilterMode === 'this_month' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
          >
            ເດືອນນີ້
          </button>
          <button
            onClick={() => handleDatePreset('last_month')}
            className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${dateFilterMode === 'last_month' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
          >
            ເດືອນຜ່ານມາ
          </button>
          <button
            onClick={() => handleDatePreset('all')}
            className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${dateFilterMode === 'all' ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'}`}
          >
            ທັງໝົດ
          </button>
        </div>
      </div>

      {/* Row 1: 5 KPI Cards ຫຼັກ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Revenue */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> Total Revenue
          </span>
          <p className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(reportData.totalRevenue).toLocaleString()} ₭
          </p>
          <p className="text-[9.5px] text-slate-400 uppercase font-bold">Customer Inflows</p>
        </div>

        {/* COGS */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" /> COGS (Purchasing)
          </span>
          <p className="text-xl sm:text-2xl font-black font-mono text-rose-600 dark:text-rose-400">
            {Math.round(reportData.totalCogs).toLocaleString()} ₭
          </p>
          <p className="text-[9.5px] text-slate-400 uppercase font-bold">Material Costs</p>
        </div>

        {/* Gross Margin */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5 text-blue-500" /> Gross Margin
          </span>
          <p className="text-xl sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
            {reportData.grossMargin.toFixed(1)}%
          </p>
          <p className="text-[9.5px] text-slate-400 font-mono">GP: {Math.round(reportData.grossProfit).toLocaleString()} ₭</p>
        </div>

        {/* 🌟 NET PROFIT (ສະແດງກຳໄລດຳເນີນງານທີ່ແທ້ຈິງ - ບໍ່ຕິດລົບແລ້ວ!) */}
        <div className={`p-5 rounded-3xl border shadow-sm space-y-1 ${
          reportData.netProfit >= 0 
            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500/20' 
            : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-500/20'
        }`}>
          <div className="flex justify-between items-center">
            <span className={`text-[10px] font-black uppercase ${reportData.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              Net Profit
            </span>
          </div>
          <p className={`text-xl sm:text-2xl font-black font-mono ${reportData.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {Math.round(reportData.netProfit).toLocaleString()} ₭
          </p>
          <p className="text-[9.5px] text-slate-400 font-bold uppercase">
            OPEX: {Math.round(reportData.totalOpex).toLocaleString()} ₭
          </p>
        </div>

        {/* Estimated ROI */}
        <div className="bg-amber-50/50 dark:bg-white/5 p-5 rounded-3xl border border-amber-500/20 shadow-sm space-y-1 col-span-2 lg:col-span-1">
          <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400">
            Estimated ROI
          </span>
          <p className="text-xl sm:text-2xl font-black font-mono text-amber-600 dark:text-amber-400">
            {reportData.roi.toFixed(1)}%
          </p>
          <p className="text-[9.5px] text-slate-400 uppercase font-bold">Return on Total Cost</p>
        </div>
      </div>

      {/* Row 2: ຍອດເງິນຕາມຊ່ອງທາງ (Cash, OnePay, LDB) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-slate-400">ເງິນສົດ (CASH)</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[9px] font-black uppercase">Cash</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(reportData.netCash).toLocaleString()} ₭
          </p>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-slate-400">BCEL ONEPAY</span>
            <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 text-[9px] font-black uppercase">OnePay</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(reportData.netOnepay).toLocaleString()} ₭
          </p>
        </div>

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-slate-400">ທະນາຄານ LDB</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-[9px] font-black uppercase">LDB</span>
          </div>
          <p className="text-2xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(reportData.netLdb).toLocaleString()} ₭
          </p>
        </div>
      </div>

      {/* Row 3: ໂຄງສ້າງຕົ້ນທຶນ & Insights ຜູ້ບໍລິຫານ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* ໂຄງສ້າງຕົ້ນທຶນ */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-500" />
              <span>ໂຄງສ້າງຕົ້ນທຶນ & ລາຍຈ່າຍ (Cost Breakdown)</span>
            </h3>
            <span className="text-xs font-mono font-bold text-slate-400">
              Total: {Math.round(reportData.totalCogs + reportData.totalOpex).toLocaleString()} ₭
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-slate-600 dark:text-slate-300">COGS (ຕົ້ນທຶນວັດຖຸດິບ)</span>
                <span className="font-mono">{Math.round(reportData.totalCogs).toLocaleString()} ₭</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div 
                  className="h-full bg-rose-500 rounded-full" 
                  style={{ width: `${(reportData.totalCogs + reportData.totalOpex) > 0 ? (reportData.totalCogs / (reportData.totalCogs + reportData.totalOpex)) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-slate-600 dark:text-slate-300">OPEX (ລາຍຈ່າຍບໍລິຫານ/ອື່ນໆ)</span>
                <span className="font-mono">{Math.round(reportData.totalOpex).toLocaleString()} ₭</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div 
                  className="h-full bg-purple-600 rounded-full" 
                  style={{ width: `${(reportData.totalCogs + reportData.totalOpex) > 0 ? (reportData.totalOpex / (reportData.totalCogs + reportData.totalOpex)) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* 🌟 ສະແດງເງິນປັນຜົນແຍກຕ່າງຫາກຊັດເຈນ (ບໍ່ນັບເປັນ OPEX) */}
            {reportData.totalDividends > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-white/5">
                <div className="flex justify-between text-xs font-black text-indigo-600 dark:text-indigo-400">
                  <span>🏷️ ເງິນປັນຜົນທີ່ຈ່າຍໃນຮອບນີ້ (Dividends Paid)</span>
                  <span className="font-mono">{Math.round(reportData.totalDividends).toLocaleString()} ₭</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  *(ແບ່ງຈາກກຳໄລສະສົມ ບໍ່ໄດ້ຖືກນັບເປັນລາຍຈ່າຍດຳເນີນງານ)*
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ບົດວິເຄາະ & Insights ຜູ້ບໍລິຫານ */}
        <div className="lg:col-span-6 bg-white dark:bg-[#073069] p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span>ບົດວິເຄາະ & Insights ຜູ້ບໍລິຫານ</span>
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[9px] font-black uppercase">
              AI Strategic
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-emerald-50/50 dark:bg-white/5 rounded-2xl border border-emerald-500/10">
              <p className="font-black text-emerald-700 dark:text-emerald-400 mb-1">
                • ອັດຕາກຳໄລຂັ້ນຕົ້ນ: {reportData.grossMargin.toFixed(1)}%
              </p>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                ຍອດຂາຍລວມ {Math.round(reportData.totalRevenue).toLocaleString()} ₭ ຫັກຕົ້ນທຶນວັດຖຸດິບ {Math.round(reportData.totalCogs).toLocaleString()} ₭ ເຫຼືອກຳໄລຂັ້ນຕົ້ນ {Math.round(reportData.grossProfit).toLocaleString()} ₭.
              </p>
            </div>

            <div className="p-3 bg-blue-50/50 dark:bg-white/5 rounded-2xl border border-blue-500/10">
              <p className="font-black text-blue-700 dark:text-blue-400 mb-1">
                • ຜົນຕອບແທນການລົງທຶນ (ROI): {reportData.roi.toFixed(1)}%
              </p>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                ກຳໄລສຸດທິຫຼັງຫັກລາຍຈ່າຍທັງໝົດໃນຊ່ວງເວລານີ້ແມ່ນ {Math.round(reportData.netProfit).toLocaleString()} ₭.
              </p>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
