import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, onSnapshot, doc, setDoc, updateDoc, addDoc,
  serverTimestamp, deleteDoc 
} from 'firebase/firestore';
import { 
  PiggyBank, ArrowUpRight, ArrowDownRight, 
  Calendar, Search, History, ArrowRightLeft, X, CheckCircle2,
  FileText, Link2, CheckSquare, Square, Trash2, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

const QUARTERS = [
  { id: 'Q1', name: 'ໄຕຣມາດ 1 (Q1)', defaultStart: '-01-01', defaultEnd: '-03-31' },
  { id: 'Q2', name: 'ໄຕຣມາດ 2 (Q2)', defaultStart: '-04-01', defaultEnd: '-06-30' },
  { id: 'Q3', name: 'ໄຕຣມາດ 3 (Q3)', defaultStart: '-07-01', defaultEnd: '-09-30' },
  { id: 'Q4', name: 'ໄຕຣມາດ 4 (Q4)', defaultStart: '-10-01', defaultEnd: '-12-31' }
];

export default function DividendSettlement({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  const [transactions, setTransactions] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedQuarter, setSelectedQuarter] = useState<string>('Q2');

  const [customStartDate, setCustomStartDate] = useState<string>('2026-04-01');
  const [customEndDate, setCustomEndDate] = useState<string>('2026-06-30');

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedTxIdsToLink, setSelectedTxIdsToLink] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState('');
  const [targetLinkQuarter, setTargetLinkQuarter] = useState('Q2');
  const [targetLinkYear, setTargetLinkYear] = useState(2026);

  const [transferToStockAmount, setTransferToStockAmount] = useState<string>('');
  const [payoutDividendAmount, setPayoutDividendAmount] = useState<string>('');
  const [payoutMethod, setPayoutMethod] = useState<'Cash' | 'OnePay' | 'LDB'>('OnePay');
  const [settleRemark, setSettleRemark] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const qObj = QUARTERS.find(q => q.id === selectedQuarter);
    if (qObj) {
      setCustomStartDate(`${selectedYear}${qObj.defaultStart}`);
      setCustomEndDate(`${selectedYear}${qObj.defaultEnd}`);
    }
  }, [selectedQuarter, selectedYear]);

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

  // 🌟 ກວດຫາບິນທີ່ສ້າງຊ້ຳຊ້ອນມື້ນີ້ (ວັນທີ 11/10/2026) ເພື່ອໃຫ້ລຶບອອກໄດ້ງ່າຍ
  const accidentalOctoberBills = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = String(tx.date || '');
      const isDividendOrReserve = tx.type === 'dividend' || tx.type === 'reserve_transfer';
      return txDate.startsWith('2026-10') && isDividendOrReserve;
    });
  }, [transactions]);

  // 🌟 ປຸ່ມລຶບບິນຊ້ຳຊ້ອນ 252 ລ້ານໃນ 1 ຄລິກ
  const handleCleanOctoberAccidentalBills = async () => {
    if (!window.confirm(`ຕ້ອງການລຶບ ${accidentalOctoberBills.length} ບິນປັນຜົນທີ່ສ້າງຊ້ຳຊ້ອນໃນເດືອນ 10 ແທ້ບໍ່? (ລຶບແລ້ວເດືອນ 10 ຈະກັບມາງາມທັນທີ)`)) {
      return;
    }
    try {
      for (const bill of accidentalOctoberBills) {
        await deleteDoc(doc(db, 'transactions', bill.id));
      }
      alert('🎉 ລຶບບິນຊ້ຳຊ້ອນສຳເລັດ! ເດືອນ 10 Reset ເປັນກຳໄລສີຂຽວແລ້ວ.');
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const financialMetrics = useMemo(() => {
    let totalStockTransferred = 0;
    let totalDividendsPaid = 0;

    transactions.forEach(tx => {
      const amt = Number(tx.amount || 0);
      const type = String(tx.type || '').toLowerCase();
      const cat = String(tx.category || '').toLowerCase();

      if (type === 'reserve_transfer' || cat === 'stock_reserve' || cat.includes('stock')) {
        totalStockTransferred += amt;
      }
      if (type === 'dividend' || cat === 'dividend' || cat === 'dividends' || cat.includes('ປັນຜົນ')) {
        totalDividendsPaid += amt;
      }
    });

    const currentStockFundBalance = Math.max(0, totalStockTransferred - totalDividendsPaid);

    let periodRevenue = 0;
    let periodExpense = 0;

    transactions.forEach(tx => {
      const txDate = String(tx.date || '');
      if (txDate >= customStartDate && txDate <= customEndDate) {
        const amt = Number(tx.amount || 0);
        const type = String(tx.type || '').toLowerCase();

        if (type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          periodRevenue += amt;
        } else if (type === 'expense') {
          periodExpense += amt;
        }
      }
    });

    const periodNetProfit = periodRevenue - periodExpense;

    return {
      totalStockTransferred,
      totalDividendsPaid,
      currentStockFundBalance,
      periodRevenue,
      periodExpense,
      periodNetProfit
    };
  }, [transactions, customStartDate, customEndDate]);

  // 🌟 Settle: ບັນທຶກວັນທີໃຫ້ຕົກຢູ່ໃນທ້າຍໄຕຣມາດ (customEndDate) ບໍ່ເອົາວັນທີມື້ນີ້!
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
      
      // 🌟 ໃຊ້ອີງຕາມວັນທີສິ້ນສຸດຂອງໄຕຣມາດນັ້ນ ເຊັ່ນ 2026-06-30 ຫຼື 2026-09-30 (ບໍ່ເອົາ 11/10)
      const settlementRecordDate = customEndDate || format(new Date(), 'yyyy-MM-dd');

      await setDoc(doc(db, 'dividend_settlements', settlementId), {
        branchId: currentBranch,
        year: selectedYear,
        quarter: selectedQuarter,
        startDate: customStartDate,
        endDate: customEndDate,
        periodNetProfit: financialMetrics.periodNetProfit,
        transferredToStock: stockAmount,
        dividendPaid: divAmount,
        paymentMethod: payoutMethod,
        remark: settleRemark.trim() || `ປັນຜົນໄຕຣມາດ ${selectedQuarter}/${selectedYear}`,
        date: settlementRecordDate,
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
          remark: `ຈ່າຍປັນຜົນ ${selectedQuarter}/${selectedYear}: ${settleRemark.trim()}`,
          date: settlementRecordDate, // 👈 ວັນທີທ້າຍໄຕຣມາດ ບໍ່ຫຼຸດມາເດືອນ 10
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
          date: settlementRecordDate,
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

  const handleLinkTransactionsToQuarter = async () => {
    if (selectedTxIdsToLink.length === 0) {
      alert('ກະລຸນາຕິກເລືອກລາຍການທີ່ຕ້ອງການຜູກກ່ອນ!');
      return;
    }

    try {
      setSaving(true);
      let totalLinkedAmount = 0;

      for (const id of selectedTxIdsToLink) {
        const tx = transactions.find(t => t.id === id);
        if (tx) {
          totalLinkedAmount += Number(tx.amount || 0);
          await updateDoc(doc(db, 'transactions', id), {
            type: 'dividend',
            category: 'dividend',
            quarter: `${targetLinkYear}-${targetLinkQuarter}`,
            isSettled: true,
            updatedAt: serverTimestamp()
          });
        }
      }

      const settlementId = `settle_${currentBranch}_${targetLinkYear}_${targetLinkQuarter}_linked_${Date.now()}`;
      await setDoc(doc(db, 'dividend_settlements', settlementId), {
        branchId: currentBranch,
        year: targetLinkYear,
        quarter: targetLinkQuarter,
        startDate: customStartDate,
        endDate: customEndDate,
        dividendPaid: totalLinkedAmount,
        transferredToStock: 0,
        paymentMethod: 'Mixed',
        remark: `ດຶງລາຍການປັນຜົນທີ່ມີຢູ່ແລ້ວ ${selectedTxIdsToLink.length} ລາຍການ ຜູກເຂົ້າ ${targetLinkQuarter}/${targetLinkYear}`,
        date: customEndDate,
        linkedTxIds: selectedTxIdsToLink,
        createdAt: serverTimestamp()
      });

      alert(`🎉 ສຳເລັດ! ໄດ້ຜູກ ${selectedTxIdsToLink.length} ລາຍການເຂົ້າ ${targetLinkQuarter}/${targetLinkYear} ຮຽບຮ້ອຍ!`);
      setSelectedTxIdsToLink([]);
      setShowLinkModal(false);
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const linkableTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const type = String(tx.type || '').toLowerCase();
      const cat = String(tx.category || '').toLowerCase();
      const remark = String(tx.remark || '').toLowerCase();

      const isDividendOrExpense = type === 'dividend' || cat === 'dividends' || cat === 'dividend' || type === 'expense';
      const isRelevant = cat.includes('dividend') || remark.includes('ປັນຜົນ') || cat.includes('ປັນຜົນ') || type === 'dividend';

      const matchSearch = linkSearch 
        ? (remark.includes(linkSearch.toLowerCase()) || cat.includes(linkSearch.toLowerCase()) || String(tx.amount).includes(linkSearch))
        : true;

      return isDividendOrExpense && isRelevant && matchSearch;
    });
  }, [transactions, linkSearch]);

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
              Custom Period Settlement & Transaction Linking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 🌟 ປຸ່ມລຶບບິນຊ້ຳຊ້ອນ 252 ລ້ານ */}
          {accidentalOctoberBills.length > 0 && (
            <button
              onClick={handleCleanOctoberAccidentalBills}
              className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-black uppercase flex items-center gap-1.5 cursor-pointer border border-rose-500/20 animate-pulse"
              title="ກົດເພື່ອລຶບບິນ 252 ລ້ານທີ່ສ້າງຜິດວັນທີມື້ນີ້ອອກ"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ລຶບບິນຊ້ຳຊ້ອນເດືອນ 10 ({accidentalOctoberBills.length})</span>
            </button>
          )}

          <button
            onClick={() => setShowLinkModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>ດຶງລາຍການທີ່ມີແລ້ວຜູກເຂົ້າ Q</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-blue-500" />
              ກຳໄລ {selectedQuarter}/{selectedYear}
            </span>
            <span className="text-[9px] font-black text-indigo-500 uppercase bg-indigo-500/10 px-1.5 py-0.5 rounded">
              Custom Range
            </span>
          </div>
          <p className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
            {Math.round(financialMetrics.periodNetProfit).toLocaleString()} ₭
          </p>
          <p className="text-[9.5px] text-slate-400 font-mono">
            {customStartDate} ➔ {customEndDate}
          </p>
        </div>

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

      {/* ຟອມ Settle */}
      <div className="bg-white dark:bg-[#073069] p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-slate-100 dark:border-white/10 pb-4">
          <div>
            <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <span>ປິດຮອບປັນຜົນໄຕຣມາດ (Custom Period Settlement)</span>
            </h3>
            <p className="text-[10.5px] text-slate-400 mt-0.5">
              ເລືອກຊ່ວງວັນທີເລີ່ມຕົ້ນ ຫາ ສິ້ນສຸດ ໄດ້ເອງ ລະບົບຈະລົງວັນທີທ້າຍໄຕຣມາດໃຫ້ ບໍ່ຫຼຸດມາກະທົບເດືອນປັດຈຸບັນ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="h-9 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
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

        {/* ຊ່ວງວັນທີ Custom */}
        <div className="p-4 bg-indigo-50/50 dark:bg-white/5 rounded-2xl border border-indigo-100 dark:border-white/10 space-y-3">
          <span className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            ກຳນົດຊ່ວງວັນທີຄິດໄລ່ກຳໄລຂອງໄຕຣມາດ {selectedQuarter}/{selectedYear}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[9.5px] font-bold text-slate-400 block mb-1">ວັນທີເລີ່ມຕົ້ນ:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none cursor-pointer"
              />
            </div>
            <div>
              <label className="text-[9.5px] font-bold text-slate-400 block mb-1">ວັນທີສິ້ນສຸດ (ວັນທີທີ່ຈະລົງບິນ):</label>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none cursor-pointer"
              />
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
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span>Note / ບັນທຶກເຫດການ</span>
            </label>
            <textarea
              rows={2}
              placeholder={`ຕົວຢ່າງ: ປັນຜົນຮອບ ${selectedQuarter}/${selectedYear} ຕັດຍອດຊ່ວງ ${customStartDate} ຫາ ${customEndDate}...`}
              value={settleRemark}
              onChange={e => setSettleRemark(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs outline-none focus:border-indigo-500"
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
                <th className="p-3.5">ໄຕຣມາດ & ຊ່ວງວັນທີ</th>
                <th className="p-3.5 text-right">ກຳໄລຂອງຊ່ວງນັ້ນ</th>
                <th className="p-3.5 text-right">ໂອນເຂົ້າ Stock</th>
                <th className="p-3.5 text-right">ປັນຜົນຈ່າຍອອກ</th>
                <th className="p-3.5">ຊ່ອງທາງ</th>
                <th className="p-3.5">Note ບັນທຶກ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {settlements.map(st => (
                <tr key={st.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <td className="p-3.5 font-mono text-slate-400">{st.date}</td>
                  <td className="p-3.5">
                    <span className="font-black text-indigo-600 dark:text-indigo-400 block">
                      {st.quarter}/{st.year}
                    </span>
                    {st.startDate && st.endDate && (
                      <span className="text-[9.5px] text-slate-400 font-mono">
                        {st.startDate} ➔ {st.endDate}
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                    {Math.round(Number(st.periodNetProfit || st.quarterNetProfit || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold text-teal-600 dark:text-teal-400">
                    +{Math.round(Number(st.transferredToStock || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                    -{Math.round(Number(st.dividendPaid || 0)).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 uppercase font-bold text-[10px] text-slate-500">{st.paymentMethod}</td>
                  <td className="p-3.5 text-slate-600 dark:text-slate-300 text-[11px] max-w-xs">{st.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal ດຶງລາຍການຜູກເຂົ້າ Q */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Link2 className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ດຶງລາຍການທີ່ມີຢູ່ແລ້ວ ຜູກເຂົ້າໄຕຣມາດ (Q)
                </h3>
              </div>
              <button onClick={() => setShowLinkModal(false)} className="cursor-pointer text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  placeholder="ຄົ້ນຫາ ວັນທີ, ຊື່ ຫຼື ຈຳນວນເງິນ..."
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                  className="w-full h-10 pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs outline-none"
                />
                <Search className="absolute left-2.5 top-3 w-4 h-4 text-slate-400" />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={targetLinkYear}
                  onChange={e => setTargetLinkYear(Number(e.target.value))}
                  className="h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                >
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select
                  value={targetLinkQuarter}
                  onChange={e => setTargetLinkQuarter(e.target.value)}
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
              {linkableTransactions.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  ບໍ່ພົບລາຍການທີ່ຕົງກັບເງື່ອນໄຂ
                </div>
              ) : (
                linkableTransactions.map(tx => {
                  const isChecked = selectedTxIdsToLink.includes(tx.id);

                  return (
                    <div 
                      key={tx.id}
                      onClick={() => {
                        setSelectedTxIdsToLink(prev => 
                          prev.includes(tx.id) ? prev.filter(i => i !== tx.id) : [...prev, tx.id]
                        );
                      }}
                      className={`p-3.5 rounded-2xl flex items-center justify-between gap-3 border transition-all cursor-pointer ${
                        isChecked 
                          ? 'bg-indigo-50/80 dark:bg-indigo-900/20 border-indigo-500' 
                          : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/5 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button type="button" className="text-indigo-600 dark:text-indigo-400">
                          {isChecked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}
                        </button>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black text-rose-500">
                              -{Math.round(Number(tx.amount || 0)).toLocaleString()} ₭
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{tx.date}</span>
                            <span className="text-[9px] px-1.5 py-0.2 bg-slate-200 dark:bg-white/10 rounded font-bold uppercase">
                              {tx.paymentMethod || 'Cash'}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-800 dark:text-white mt-0.5">
                            {tx.remark || tx.category || 'Dividends payout'}
                          </p>
                        </div>
                      </div>

                      {tx.quarter && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-emerald-500/10 text-emerald-600 rounded-md">
                          ຜູກແລ້ວ: {tx.quarter}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500">
                ເລືອກແລ້ວ: <strong className="text-indigo-600 dark:text-indigo-400">{selectedTxIdsToLink.length}</strong> ລາຍການ
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="button"
                  disabled={saving || selectedTxIdsToLink.length === 0}
                  onClick={handleLinkTransactionsToQuarter}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>{saving ? 'ກຳລັງຜູກ...' : `ຢືນຢັນຜູກເຂົ້າ ${targetLinkQuarter}/${targetLinkYear}`}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
