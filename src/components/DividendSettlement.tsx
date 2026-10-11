import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, onSnapshot, doc, setDoc, updateDoc, addDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { 
  PiggyBank, ArrowUpRight, ArrowDownRight, 
  Calendar, Search, History, ArrowRightLeft, X, CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

const QUARTERS = [
  { id: 'Q1', name: 'ໄຕຣມາດ 1 (Q1: ເດືອນ 1, 2, 3)', months: ['01', '02', '03'] },
  { id: 'Q2', name: 'ໄຕຣມາດ 2 (Q2: ເດືອນ 4, 5, 6)', months: ['04', '05', '06'] },
  { id: 'Q3', name: 'ໄຕຣມາດ 3 (Q3: ເດືອນ 7, 8, 9)', months: ['07', '08', '09'] },
  { id: 'Q4', name: 'ໄຕຣມາດ 4 (Q4: ເດືອນ 10, 11, 12)', months: ['10', '11', '12'] }
];

export default function DividendSettlement({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  const [transactions, setTransactions] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState<string>('Q3');

  // Modal ຍ້າຍລາຍຈ່າຍເກົ່າ
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [migrateSearch, setMigrateSearch] = useState('');
  const [targetMigrateQuarter, setTargetMigrateQuarter] = useState('Q3');
  const [targetMigrateYear, setTargetMigrateYear] = useState(new Date().getFullYear());

  // Form Settle
  const [transferToStockAmount, setTransferToStockAmount] = useState<string>('');
  const [payoutDividendAmount, setPayoutDividendAmount] = useState<string>('');
  const [payoutMethod, setPayoutMethod] = useState<'Cash' | 'OnePay' | 'LDB'>('OnePay');
  const [settleRemark, setSettleRemark] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 1. ດຶງຂໍ້ມູນ Real-time
  useEffect(() => {
    const unsubT = onSnapshot(collection(db, 'transactions'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === currentBranch));
    }, err => handleFirestoreError(err, OperationType.LIST, 'transactions'));

    const unsubS = onSnapshot(collection(db, 'dividend_settlements'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSettlements(all.filter((s: any) => (s.branchId || 'branch_1') === currentBranch));
    });

    return () => {
      unsubT();
      unsubS();
    };
  }, [currentBranch]);

  // 2. ຄິດໄລ່ຍອດເງິນ Stock & ກຳໄລສະສົມ
  const financialMetrics = useMemo(() => {
    let totalStockTransferred = 0;
    let totalDividendsPaid = 0;

    transactions.forEach(tx => {
      const amt = Number(tx.amount || 0);
      const type = String(tx.type || '').toLowerCase();
      const cat = String(tx.category || '').toLowerCase();

      if (type === 'reserve_transfer' || cat === 'stock_reserve' || cat.includes('ເງິນແຮ') || cat.includes('stock')) {
        totalStockTransferred += amt;
      }
      if (type === 'dividend' || cat === 'dividend' || cat.includes('ປັນຜົນ')) {
        totalDividendsPaid += amt;
      }
    });

    // 🌟 ເງິນແຮ່ໝູນວຽນ (ເງິນ Stock) ຄົງເຫຼືອຕົວຈິງ
    const currentStockFundBalance = Math.max(0, totalStockTransferred - totalDividendsPaid);

    const quarterDef = QUARTERS.find(q => q.id === selectedQuarter);
    const quarterMonths = quarterDef?.months.map(m => `${selectedYear}-${m}`) || [];

    let quarterRevenue = 0;
    let quarterExpense = 0;

    transactions.forEach(tx => {
      const txDate = String(tx.date || '').slice(0, 7);
      if (quarterMonths.includes(txDate)) {
        const amt = Number(tx.amount || 0);
        const type = String(tx.type || '').toLowerCase();

        if (type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          quarterRevenue += amt;
        } else if (type === 'expense') {
          quarterExpense += amt;
        }
      }
    });

    const quarterNetProfit = quarterRevenue - quarterExpense;

    return {
      totalStockTransferred,
      totalDividendsPaid,
      currentStockFundBalance,
      quarterRevenue,
      quarterExpense,
      quarterNetProfit
    };
  }, [transactions, selectedYear, selectedQuarter]);

  // 3. ບັນທຶກ Settle ປັນຜົນ
  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    const divAmount = Number(payoutDividendAmount.replace(/,/g, '')) || 0;
    const stockAmount = Number(transferToStockAmount.replace(/,/g, '')) || 0;

    if (divAmount <= 0 && stockAmount <= 0) {
      alert('ກະລຸນາປ້ອນຍອດເງິນໂອນເຂົ້າແຮ່ ຫຼື ຍອດປັນຜົນ!');
      return;
    }

    try {
      setSaving(true);
      const settlementId = `settle_${currentBranch}_${selectedYear}_${selectedQuarter}_${Date.now()}`;

      await setDoc(doc(db, 'dividend_settlements', settlementId), {
        branchId: currentBranch,
        year: selectedYear,
        quarter: selectedQuarter,
        quarterNetProfit: financialMetrics.quarterNetProfit,
        transferredToStock: stockAmount,
        dividendPaid: divAmount,
        paymentMethod: payoutMethod,
        remark: settleRemark.trim() || `ປັນຜົນໄຕຣມາດ ${selectedQuarter}/${selectedYear}`,
        date: format(new Date(), 'yyyy-MM-dd'),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin'
      });

      if (divAmount > 0) {
        await addDoc(collection(db, 'transactions'), {
          branchId: currentBranch,
          type: 'dividend',
          category: 'dividend',
          quarter: `${selectedYear}-${selectedQuarter}`,
          amount: divAmount,
          paymentMethod: payoutMethod,
          remark: `ຈ່າຍປັນຜົນ ${selectedQuarter}/${selectedYear} (Settle)`,
          date: format(new Date(), 'yyyy-MM-dd'),
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin'
        });
      }

      if (stockAmount > 0) {
        await addDoc(collection(db, 'transactions'), {
          branchId: currentBranch,
          type: 'reserve_transfer',
          category: 'stock_reserve',
          quarter: `${selectedYear}-${selectedQuarter}`,
          amount: stockAmount,
          paymentMethod: payoutMethod,
          remark: `ໂອນເຂົ້າເງິນແຮ່ໝູນວຽນ/Stock (${selectedQuarter}/${selectedYear})`,
          date: format(new Date(), 'yyyy-MM-dd'),
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin'
        });
      }

      alert(`✅ ບັນທຶກ Settle ປັນຜົນ ${selectedQuarter}/${selectedYear} ສຳເລັດ!`);
      setPayoutDividendAmount('');
      setTransferToStockAmount('');
      setSettleRemark('');
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // 4. 🌟 ຍ້າຍລາຍຈ່າຍເກົ່າ ➔ ປ່ຽນເປັນປັນຜົນ Q1-Q4
  const handleMigrateExpenseToDividend = async (txId: string, quarter: string, year: number) => {
    try {
      await updateDoc(doc(db, 'transactions', txId), {
        type: 'dividend',
        category: 'dividend',
        quarter: `${year}-${quarter}`,
        migratedAt: serverTimestamp()
      });
      alert(`🎉 ຍ້າຍລາຍການນີ້ໄປເປັນ "ປັນຜົນ ${quarter}/${year}" ສຳເລັດ! (ລາຍຈ່າຍເດືອນເກົ່າຫຼຸດລົງແລ້ວ)`);
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const candidateExpenses = useMemo(() => {
    return transactions.filter(tx => {
      const isExpense = tx.type === 'expense';
      const remark = String(tx.remark || '').toLowerCase();
      const cat = String(tx.category || '').toLowerCase();
      const matchSearch = migrateSearch 
        ? (remark.includes(migrateSearch.toLowerCase()) || cat.includes(migrateSearch.toLowerCase()) || String(tx.amount).includes(migrateSearch))
        : (remark.includes('ປັນຜົນ') || cat.includes('ປັນຜົນ') || remark.includes('dividend') || remark.includes('ຖອນ') || remark.includes('stock'));
      return isExpense && matchSearch;
    });
  }, [transactions, migrateSearch]);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <PiggyBank className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {i18n.language === 'la' ? 'ປັນຜົນໄຕຣມາດ & ເງິນແຮ່ໝູນວຽນ (Stock Fund)' : 'Quarterly Dividends & Reserve Stock Fund'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              Profit Settlement & Retained Capital Engine
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowMigrateModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>ຍ້າຍລາຍຈ່າຍເກົ່າໄປເປັນປັນຜົນ</span>
        </button>
      </div>

      {/* 4 KPI Cards (ລວມທັງ Card ເງິນ Stock) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: ເງິນແຮ່ໝູນວຽນ (ເງິນ Stock) */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-700 text-white p-5 rounded-3xl shadow-lg space-y-1 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-emerald-100 flex items-center gap-1">
              <PiggyBank className="w-3.5 h-3.5" />
              ເງິນແຮ່ໝູນວຽນ (ເງິນ Stock)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-white/20 text-[9px] font-black uppercase">
              Current Reserve
            </span>
          </div>
          <p className="text-2xl font-black font-mono mt-1">
            {Math.round(financialMetrics.currentStockFundBalance).toLocaleString()} ₭
          </p>
          <p className="text-[10px] text-emerald-100 font-bold">
            ໂອນເຂົ້າສະສົມ: {Math.round(financialMetrics.totalStockTransferred).toLocaleString()} ₭
          </p>
        </div>

        {/* Card 2: ຍອດປັນຜົນທີ່ຈ່າຍແລ້ວ */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
            ປັນຜົນທີ່ຈ່າຍແລ້ວທັງໝົດ
          </span>
          <p className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 mt-1">
            {Math.round(financialMetrics.totalDividendsPaid).toLocaleString()} ₭
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase">
            Paid-out Dividends
          </p>
        </div>

        {/* Card 3: ກຳໄລໄຕຣມາດທີ່ເລືອກ */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-blue-500" />
              ກຳໄລໄຕຣມາດ {selectedQuarter}/{selectedYear}
            </span>
            <span className="text-[9px] font-black text-indigo-500 uppercase bg-indigo-500/10 px-1.5 py-0.5 rounded">
              3 ເດືອນ
            </span>
          </div>
          <p className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
            {Math.round(financialMetrics.quarterNetProfit).toLocaleString()} ₭
          </p>
          <p className="text-[10px] text-slate-400 font-bold">
            ລາຍຮັບ: {Math.round(financialMetrics.quarterRevenue).toLocaleString()} ₭
          </p>
        </div>

        {/* Card 4: ຮອບທີ່ Settle ແລ້ວ */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ຮອບທີ່ Settle ສຳເລັດ
          </span>
          <p className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1">
            {settlements.length} <span className="text-sm font-normal text-slate-400">ຄັ້ງ</span>
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase">
            Settlement Records
          </p>
        </div>
      </div>

      {/* ຟອມ Settle ປັນຜົນໄຕຣມາດ Q1 - Q4 */}
      <div className="bg-white dark:bg-[#073069] p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 dark:border-white/10 pb-4">
          <div>
            <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <span>ປິດຮອບປັນຜົນໄຕຣມາດ (Quarterly Settlement Desk)</span>
            </h3>
            <p className="text-[10.5px] text-slate-400 mt-0.5">
              ເລືອກໄຕຣມາດທີ່ຕ້ອງການປັນຜົນ ລະບົບຈະດຶງກຳໄລ 3 ເດືອນມາໃຫ້ອັດຕະໂນມັດ ໂດຍບໍ່ກະທົບລາຍຈ່າຍຂອງເດືອນໃດເລີຍ.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="h-9 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl text-xs font-bold">
              {QUARTERS.map(q => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelectedQuarter(q.id)}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    selectedQuarter === q.id ? 'bg-[#052659] text-white shadow-xs' : 'text-slate-500'
                  }`}
                >
                  {q.id}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveSettlement} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                1. ໂອນເຂົ້າເງິນແຮ່ໝູນວຽນ (ເງິນ Stock) (₭)
              </label>
              <input
                type="text"
                placeholder="0"
                value={transferToStockAmount}
                onChange={e => {
                  const val = e.target.value.replace(/,/g, '');
                  if (!isNaN(Number(val))) setTransferToStockAmount(Number(val).toLocaleString());
                }}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 block mb-1">
                2. ຍອດປັນຜົນອອກຕົວຈິງ (Dividend Payout) (₭)
              </label>
              <input
                type="text"
                placeholder="0"
                value={payoutDividendAmount}
                onChange={e => {
                  const val = e.target.value.replace(/,/g, '');
                  if (!isNaN(Number(val))) setPayoutDividendAmount(Number(val).toLocaleString());
                }}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-emerald-500/30 text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                3. ຈ່າຍຜ່ານຊ່ອງທາງໃດ
              </label>
              <select
                value={payoutMethod}
                onChange={e => setPayoutMethod(e.target.value as any)}
                className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none cursor-pointer"
              >
                <option value="OnePay">BCEL OnePay</option>
                <option value="Cash">ເງິນສົດ (Cash)</option>
                <option value="LDB">ທະນາຄານ LDB</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
              ໝາຍເຫດ (Remark)
            </label>
            <input
              type="text"
              placeholder={`ຕົວຢ່າງ: ປັນຜົນກຳໄລໄຕຣມາດ ${selectedQuarter}/${selectedYear}`}
              value={settleRemark}
              onChange={e => setSettleRemark(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase rounded-2xl shadow-lg cursor-pointer transition-all disabled:opacity-50"
          >
            {saving ? 'ກຳລັງບັນທຶກ...' : `ບັນທຶກ Settle ປັນຜົນ (${selectedQuarter}/${selectedYear})`}
          </button>
        </form>
      </div>

      {/* ປະຫວັດການ Settle */}
      <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
          <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-500" />
            <span>ປະຫວັດການ Settle ປັນຜົນທັງໝົດ</span>
          </h3>
          <span className="text-[10px] text-slate-400 font-bold uppercase">
            {settlements.length} ລາຍການ
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
              <tr>
                <th className="p-3.5">ວັນທີ Settle</th>
                <th className="p-3.5">ໄຕຣມາດ</th>
                <th className="p-3.5 text-right">ກຳໄລໄຕຣມາດ</th>
                <th className="p-3.5 text-right">ໂອນເຂົ້າ Stock</th>
                <th className="p-3.5 text-right">ປັນຜົນຈ່າຍອອກ</th>
                <th className="p-3.5">ຊ່ອງທາງ</th>
                <th className="p-3.5">ໝາຍເຫດ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {settlements.map(st => (
                <tr key={st.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <td className="p-3.5 font-mono text-slate-400">{st.date}</td>
                  <td className="p-3.5 font-black text-indigo-600 dark:text-indigo-400">
                    {st.quarter}/{st.year}
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                    {Math.round(Number(st.quarterNetProfit || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold text-teal-600 dark:text-teal-400">
                    +{Math.round(Number(st.transferredToStock || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                    -{Math.round(Number(st.dividendPaid || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 uppercase font-bold text-[10px] text-slate-500">{st.paymentMethod}</td>
                  <td className="p-3.5 text-slate-500 text-[11px]">{st.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL ຍ້າຍລາຍຈ່າຍເກົ່າ ➔ ປ່ຽນເປັນປັນຜົນ Q1 - Q4 */}
      {showMigrateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ຍ້າຍລາຍຈ່າຍເກົ່າໄປເປັນ "ປັນຜົນໄຕຣມາດ (Q1 - Q4)"
                </h3>
              </div>
              <button onClick={() => setShowMigrateModal(false)} className="cursor-pointer text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-300">
              ເລືອກລາຍການທີ່ເຄີຍບັນທຶກຜິດວ່າເປັນ "ລາຍຈ່າຍ (Expense)" ແລ້ວຍ້າຍໄປເປັນ **ປັນຜົນໄຕຣມາດ**. ລາຍຈ່າຍເດືອນນັ້ນຈະຫຼຸດລົງ ແລະ ກຳໄລຈະກັບມາງາມຄືເກົ່າ!
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  placeholder="ຄົ້ນຫາຊື່ບິນ ຫຼື ຈຳນວນເງິນ..."
                  value={migrateSearch}
                  onChange={e => setMigrateSearch(e.target.value)}
                  className="w-full h-10 pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs outline-none"
                />
                <Search className="absolute left-2.5 top-3 w-4 h-4 text-slate-400" />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={targetMigrateYear}
                  onChange={e => setTargetMigrateYear(Number(e.target.value))}
                  className="h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                >
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select
                  value={targetMigrateQuarter}
                  onChange={e => setTargetMigrateQuarter(e.target.value)}
                  className="h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                >
                  <option value="Q1">Q1 (ເດືອນ 1-3)</option>
                  <option value="Q2">Q2 (ເດືອນ 4-6)</option>
                  <option value="Q3">Q3 (ເດືອນ 7-9)</option>
                  <option value="Q4">Q4 (ເດືອນ 10-12)</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {candidateExpenses.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  ບໍ່ພົບລາຍຈ່າຍທີ່ຕົງກັບເງື່ອນໄຂ (ລອງພິມຄຳຄົ້ນຫາໃນຊ່ອງຄົ້ນຫາ)
                </div>
              ) : (
                candidateExpenses.map(tx => (
                  <div 
                    key={tx.id}
                    className="p-3.5 bg-slate-50 dark:bg-white/5 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border border-slate-100 dark:border-white/5"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black text-rose-500">
                          {Math.round(Number(tx.amount || 0)).toLocaleString()} ₭
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{tx.date}</span>
                        <span className="text-[9px] px-1.5 py-0.2 bg-slate-200 dark:bg-white/10 rounded font-bold uppercase">
                          {tx.paymentMethod || 'Cash'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white mt-0.5">
                        {tx.remark || tx.category || 'Expense item'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleMigrateExpenseToDividend(tx.id, targetMigrateQuarter, targetMigrateYear)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      <span>ຍ້າຍໄປ {targetMigrateQuarter}/{targetMigrateYear}</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/10">
              <button
                onClick={() => setShowMigrateModal(false)}
                className="w-full h-10 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-800 dark:text-white text-xs font-black uppercase rounded-xl cursor-pointer"
              >
                ປິດໜ້າຕ່າງ
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
