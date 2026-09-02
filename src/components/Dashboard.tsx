import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, Activity, History, BrainCircuit, 
  Loader2, X, Search, ChevronRight, Package, AlertTriangle,
  CheckCircle2, Sparkles, Wallet, CreditCard, Building2, 
  DollarSign, Calendar, Filter, Percent, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';

interface DashboardProps {
  userSettings: any;
  user?: User | null;
  selectedBranch?: string;
}

// 🛡️ 1. SAFE DATE NORMALIZER (ຮອງຮັບທຸກຮູບແບບວັນທີ String, Timestamp, Date)
const toStandardDate = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const clean = raw.trim().split('T')[0];
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3 && parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return clean;
  }
  if (raw && typeof raw.toDate === 'function') {
    try { return format(raw.toDate(), 'yyyy-MM-dd'); } catch { return ''; }
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    try { return format(raw, 'yyyy-MM-dd'); } catch { return ''; }
  }
  return '';
};

// 🛡️ 2. SAFE NUMBER PARSER
const parseAmount = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export default function Dashboard({ userSettings, user, selectedBranch }: DashboardProps) {
  const { t, i18n } = useTranslation();

  // Timeframe Preset Filter: 'month' | 'last_month' | 'today' | 'all' | 'custom'
  const [timeframeMode, setTimeframeMode] = useState<'month' | 'last_month' | 'today' | 'all' | 'custom'>('month');
  const [selectedMonthStr, setSelectedMonthStr] = useState<string>(() => format(new Date(), 'yyyy-MM'));

  // Firestore Real-time Collections
  const [fsProducts, setFsProducts] = useState<any[]>([]);
  const [fsSupplierPrices, setFsSupplierPrices] = useState<any[]>([]);
  const [fsRecipes, setFsRecipes] = useState<any[]>([]);
  const [fsMenuSales, setFsMenuSales] = useState<any[]>([]);
  const [fsAdjustments, setFsAdjustments] = useState<any[]>([]);
  const [fsTransactions, setFsTransactions] = useState<any[]>([]);
  const [fsLoading, setFsLoading] = useState(true);

  // Modal States
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Subscribe Real-time to Firestore
  useEffect(() => {
    setFsLoading(true);
    const branch = selectedBranch || 'branch_1';
    const unsubscribes: Array<() => void> = [];

    try {
      unsubscribes.push(onSnapshot(collection(db, 'products'), (snap) => {
        setFsProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }));

      unsubscribes.push(onSnapshot(collection(db, 'supplierPrices'), (snap) => {
        setFsSupplierPrices(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }));

      unsubscribes.push(onSnapshot(collection(db, 'recipes'), (snap) => {
        setFsRecipes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }));

      unsubscribes.push(onSnapshot(collection(db, 'menu_sales'), (snap) => {
        setFsMenuSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }));

      unsubscribes.push(onSnapshot(collection(db, 'inventory'), (snap) => {
        setFsAdjustments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }));

      unsubscribes.push(onSnapshot(collection(db, 'transactions'), (snap) => {
        const all = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const branchFiltered = all.filter((tx: any) => (tx.branchId || 'branch_1') === branch);
        setFsTransactions(branchFiltered);
        setFsLoading(false);
      }));

    } catch (err) {
      console.error("Firestore dashboard error:", err);
      setFsLoading(false);
    }

    return () => unsubscribes.forEach(unsub => unsub());
  }, [selectedBranch]);

  const normalizePayment = (src?: string): 'Cash' | 'Onepay' | 'LDB' => {
    if (!src) return 'Cash';
    const s = String(src).toLowerCase();
    if (s.includes('ldb')) return 'LDB';
    if (s.includes('onepay') || s.includes('online') || s.includes('bank') || s.includes('transfer')) return 'Onepay';
    return 'Cash';
  };

  // Quick Preset Handlers
  const handlePresetSelect = (preset: 'month' | 'last_month' | 'today' | 'all') => {
    setTimeframeMode(preset);
    if (preset === 'month') {
      setSelectedMonthStr(format(new Date(), 'yyyy-MM'));
    } else if (preset === 'last_month') {
      setSelectedMonthStr(format(subMonths(new Date(), 1), 'yyyy-MM'));
    }
  };

  // ================= 📊 1. DYNAMIC FINANCIAL KPIS & CASH FLOW =================
  const financialOverview = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = format(now, 'yyyy-MM');
    const lastMonthPrefix = format(subMonths(now, 1), 'yyyy-MM');
    const todayPrefix = format(now, 'yyyy-MM-dd');

    // Filter helper based on selected timeframe
    const matchTimeframe = (dateVal: any) => {
      if (timeframeMode === 'all') return true;
      const dStr = toStandardDate(dateVal);
      if (!dStr) return false;

      if (timeframeMode === 'today') {
        return dStr === todayPrefix;
      }
      if (timeframeMode === 'last_month') {
        return dStr.startsWith(lastMonthPrefix);
      }
      if (timeframeMode === 'month') {
        return dStr.startsWith(currentMonthPrefix);
      }
      if (timeframeMode === 'custom') {
        return dStr.startsWith(selectedMonthStr);
      }
      return true;
    };

    let totalRevenue = 0;
    let totalPurchasing = 0;
    let totalOPEX = 0;

    let cashIncome = 0;
    let cashExpense = 0;
    let onepayIncome = 0;
    let onepayExpense = 0;
    let ldbIncome = 0;
    let ldbExpense = 0;

    const importedSupplierPriceIds = new Set<string>();
    fsTransactions.forEach(tx => {
      if (Array.isArray(tx.supplierPriceIds)) {
        tx.supplierPriceIds.forEach((id: string) => importedSupplierPriceIds.add(id));
      }
    });

    // 1. Process all active transactions
    const filteredTxList = fsTransactions.filter(tx => matchTimeframe(tx.date || tx.createdAt));

    filteredTxList.forEach(tx => {
      const amt = parseAmount(tx.amount);
      const ch = normalizePayment(tx.source);
      const isIncome = tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales';

      if (isIncome) {
        totalRevenue += amt;
        if (ch === 'Cash') cashIncome += amt;
        else if (ch === 'Onepay') onepayIncome += amt;
        else if (ch === 'LDB') ldbIncome += amt;
      } else {
        const cat = String(tx.category || '').toLowerCase();
        const isPurchasing = cat.includes('purchas') || cat.includes('supply') || cat.includes('ຊື້');

        if (isPurchasing) {
          totalPurchasing += amt;
        } else {
          totalOPEX += amt;
        }

        if (ch === 'Cash') cashExpense += amt;
        else if (ch === 'Onepay') onepayExpense += amt;
        else if (ch === 'LDB') ldbExpense += amt;
      }
    });

    // 2. Also process direct supplier purchases that weren't pulled into transactions
    fsSupplierPrices.forEach(sp => {
      const dStr = toStandardDate(sp.date || sp.createdAt);
      if (!dStr || importedSupplierPriceIds.has(sp.id)) return;

      if (matchTimeframe(dStr)) {
        const amt = sp.totalPriceLAK !== undefined
          ? parseAmount(sp.totalPriceLAK)
          : (sp.currency === 'LAK' ? parseAmount(sp.priceOriginal) : parseAmount(sp.priceOriginal) * parseAmount(sp.exchangeRate || 1)) * (parseAmount(sp.quantity) || 1);

        totalPurchasing += amt;
        const ch = normalizePayment(sp.paymentMethod);
        if (ch === 'Cash') cashExpense += amt;
        else if (ch === 'Onepay') onepayExpense += amt;
        else if (ch === 'LDB') ldbExpense += amt;
      }
    });

    const totalExpenses = totalPurchasing + totalOPEX;
    const grossProfit = totalRevenue - totalPurchasing;
    const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netProfit = totalRevenue - totalExpenses;
    const estimatedROI = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

    const cashNet = cashIncome - cashExpense;
    const onepayNet = onepayIncome - onepayExpense;
    const ldbNet = ldbIncome - ldbExpense;
    const totalNetLiquidity = cashNet + onepayNet + ldbNet;

    // 7-Day Inflow vs Outflow Trend
    const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i));
    const trends7Days = last7Days.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayTxs = fsTransactions.filter(tx => toStandardDate(tx.date || tx.createdAt) === dateStr);

      let income = 0;
      let expense = 0;
      dayTxs.forEach(tx => {
        const amt = parseAmount(tx.amount);
        if (tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          income += amt;
        } else {
          expense += amt;
        }
      });

      return {
        day: format(date, 'EEE'),
        date: format(date, 'dd/MM'),
        income,
        expense
      };
    });

    // Display Title
    let activePeriodLabel = 'ເດືອນນີ້ (' + format(now, 'MMMM yyyy') + ')';
    if (timeframeMode === 'all') activePeriodLabel = 'ທັງໝົດ (All-Time)';
    else if (timeframeMode === 'last_month') activePeriodLabel = 'ເດືອນຜ່ານມາ (' + format(subMonths(now, 1), 'MMMM yyyy') + ')';
    else if (timeframeMode === 'today') activePeriodLabel = 'ມື້ນີ້ (' + format(now, 'dd/MM/yyyy') + ')';
    else if (timeframeMode === 'custom') activePeriodLabel = selectedMonthStr;

    return {
      totalRevenue,
      totalPurchasing,
      totalOPEX,
      totalExpenses,
      grossProfit,
      grossMarginPercent,
      netProfit,
      estimatedROI,
      cashIncome,
      cashExpense,
      cashNet,
      onepayIncome,
      onepayExpense,
      onepayNet,
      ldbIncome,
      ldbExpense,
      ldbNet,
      totalNetLiquidity,
      trends7Days,
      transactionCount: filteredTxList.length,
      activePeriodLabel
    };
  }, [fsTransactions, fsSupplierPrices, timeframeMode, selectedMonthStr]);

  // ================= 📦 2. INVENTORY HEALTH CALCULATION =================
  const inventoryOverview = useMemo(() => {
    if (fsProducts.length === 0) return { stockHealth: [], lowStockCount: 0, totalProducts: 0 };

    const healthList = fsProducts.map(prod => {
      const inPrices = fsSupplierPrices.filter(sp => sp.productId === prod.id);
      const totalBought = inPrices.reduce((sum, sp) => {
        const qty = parseAmount(sp.quantity);
        const subQty = parseAmount(sp.quantityPerUnit) || 1;
        return sum + (qty * subQty);
      }, 0);

      const adjs = fsAdjustments.filter(adj => adj.productId === prod.id);
      const adjTotal = adjs.reduce((sum, adj) => sum + parseAmount(adj.amount), 0);

      let totalSoldUnits = 0;
      fsMenuSales.forEach(sale => {
        const itemsSold = sale.itemsSold || {};
        Object.entries(itemsSold).forEach(([recipeId, qtySold]) => {
          const count = parseAmount(qtySold);
          if (count <= 0) return;
          const recipe = fsRecipes.find(r => r.id === recipeId);
          if (!recipe) return;
          (recipe.ingredients || []).forEach((ing: any) => {
            if (ing.productId === prod.id) {
              totalSoldUnits += parseAmount(ing.amount) * count;
            }
          });
        });
      });

      const currentBalance = Math.max(0, totalBought + adjTotal - totalSoldUnits);
      const minStock = parseAmount(prod.minStock) || 10;
      const isCritical = currentBalance <= minStock;
      const isWarning = currentBalance <= (minStock * 1.5);

      return {
        id: prod.id,
        name: prod.name,
        unit: prod.unit || 'UNIT',
        current: currentBalance,
        minStock,
        status: isCritical ? 'Critical' : isWarning ? 'Warning' : 'Healthy'
      };
    });

    const lowStockCount = healthList.filter(item => item.status === 'Critical').length;

    return {
      stockHealth: healthList,
      lowStockCount,
      totalProducts: fsProducts.length
    };
  }, [fsProducts, fsSupplierPrices, fsAdjustments, fsMenuSales, fsRecipes]);

  // ================= 💡 3. EXECUTIVE SMART INSIGHTS =================
  const smartInsights = useMemo(() => {
    const list: Array<{ id: string; titleLa: string; titleEn: string; descLa: string; descEn: string; type: 'warning' | 'success' | 'info' }> = [];

    if (financialOverview.totalRevenue > 0) {
      if (financialOverview.netProfit > 0 && financialOverview.grossMarginPercent >= 40) {
        list.push({
          id: 'profit-strong',
          titleLa: 'ອັດຕາກຳໄລຂັ້ນຕົ້ນແຂງແກ່ນ',
          titleEn: 'Strong Profit Margin',
          descLa: `ທຸລະກິດມີ Gross Margin ສູງເຖິງ ${financialOverview.grossMarginPercent.toFixed(1)}% ແລະ ສ້າງກຳໄລສຸດທິ ${Math.round(financialOverview.netProfit).toLocaleString()} ₭.`,
          descEn: `Gross Margin of ${financialOverview.grossMarginPercent.toFixed(1)}% yielding ${Math.round(financialOverview.netProfit).toLocaleString()} ₭ Net Profit.`,
          type: 'success'
        });
      } else if (financialOverview.netProfit < 0) {
        list.push({
          id: 'profit-loss',
          titleLa: 'ແຈ້ງເຕືອນລາຍຈ່າຍເກີນຍອດຂາຍ',
          titleEn: 'Operating Deficit Alert',
          descLa: `ລາຍຈ່າຍລວມສູງກວ່າຍອດຂາຍ ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭. ຄວນກວດສອບຕົ້ນທຶນການຈັດຊື້.`,
          descEn: `Total expenses exceed revenue by ${Math.abs(Math.round(financialOverview.netProfit)).toLocaleString()} ₭.`,
          type: 'warning'
        });
      }
    }

    if (inventoryOverview.lowStockCount > 0) {
      list.push({
        id: 'low-stock-alert',
        titleLa: `ພົບສິນຄ້າໃກ້ໝົດສະຕັອກ ${inventoryOverview.lowStockCount} ລາຍການ`,
        titleEn: `${inventoryOverview.lowStockCount} Items Below Safety Stock`,
        descLa: 'ມີວັດຖຸດິບຫຼັກຫຼຸດລະດັບ Min Stock, ແນະນຳໃຫ້ກວດສອບແຖບ Suppliers ເພື່ອຈັດຊື້ເຂົ້າສາງ.',
        descEn: 'Core ingredients reached safety limits. Consider scheduling restock.',
        type: 'warning'
      });
    }

    const onepayRatio = financialOverview.totalRevenue > 0 ? (financialOverview.onepayIncome / financialOverview.totalRevenue) * 100 : 0;
    if (onepayRatio > 50) {
      list.push({
        id: 'onepay-dominance',
        titleLa: 'ການຊຳລະຜ່ານ BCEL OnePay ກວມເອົາສ່ວນໃຫຍ່',
        titleEn: 'High OnePay QR Share',
        descLa: `ລູກຄ້າຊຳລະຜ່ານ BCEL OnePay ເຖິງ ${onepayRatio.toFixed(0)}% ຂອງຍອດຂາຍທັງໝົດ.`,
        descEn: `OnePay QR accounts for ${onepayRatio.toFixed(0)}% of total inflows.`,
        type: 'info'
      });
    }

    if (list.length === 0) {
      list.push({
        id: 'system-ready',
        titleLa: 'ລະບົບ Real-time ເຊື່ອມຕໍ່ສົມບູນ',
        titleEn: 'Real-time System Ready',
        descLa: 'ທຸກທຸລະກຳທາງການເງິນ ແລະ ການເຄື່ອນໄຫວສາງສິນຄ້າຖືກ Sync ກັບ Cloud Database ຢ່າງປອດໄພ.',
        descEn: 'All transactions and inventory data are live and securely synced.',
        type: 'info'
      });
    }

    return list;
  }, [financialOverview, inventoryOverview]);

  if (fsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-xs font-bold text-slate-400 uppercase mt-4 tracking-widest">
          Loading Live Dashboard...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ================= 1. HEADER & TIMEFRAME SELECTOR ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 text-primary rounded-2xl">
            <BrainCircuit className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">
                {i18n.language === 'la' ? 'ພາບລວມລະບົບ (Executive Dashboard)' : 'Executive Business Dashboard'}
              </h2>
              <span className="text-[8.5px] font-black uppercase px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? 'ສາຂາ 1' : 'ສາຂາ 2'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              ສະແດງສະເພາະ: {financialOverview.activePeriodLabel}
            </p>
          </div>
        </div>

        {/* 📅 Preset Buttons + Month Picker */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <input
            type="month"
            value={selectedMonthStr}
            onChange={(e) => {
              setSelectedMonthStr(e.target.value);
              setTimeframeMode('custom');
            }}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white outline-none cursor-pointer"
          />

          <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
            <button
              type="button"
              onClick={() => handlePresetSelect('today')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                timeframeMode === 'today' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {i18n.language === 'la' ? 'ມື້ນີ້' : 'Today'}
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('month')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                timeframeMode === 'month' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນນີ້' : 'This Month'}
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('last_month')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                timeframeMode === 'last_month' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {i18n.language === 'la' ? 'ເດືອນກ່ອນ' : 'Last Month'}
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                timeframeMode === 'all' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {i18n.language === 'la' ? 'ທັງໝົດ' : 'All-Time'}
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. EXECUTIVE FINANCIAL KPIS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* Total Revenue */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
            {i18n.language === 'la' ? 'ຍອດຂາຍລວມ (Revenue)' : 'Total Revenue'}
          </span>
          <p className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(financialOverview.totalRevenue).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">Customer Inflows</p>
        </div>

        {/* COGS Purchasing */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
            {i18n.language === 'la' ? 'ຕົ້ນທຶນວັດຖຸດິບ (Purchasing)' : 'COGS / Materials'}
          </span>
          <p className="text-xl font-black font-mono text-rose-500 dark:text-rose-400">
            {Math.round(financialOverview.totalPurchasing).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">Material Procurement</p>
        </div>

        {/* Gross Margin % */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
            <Percent className="w-3.5 h-3.5 text-blue-500" />
            {i18n.language === 'la' ? 'ອັດຕາກຳໄລຂັ້ນຕົ້ນ' : 'Gross Margin'}
          </span>
          <p className="text-xl font-black font-mono text-blue-600 dark:text-blue-400">
            {financialOverview.grossMarginPercent.toFixed(1)}%
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            GP: {Math.round(financialOverview.grossProfit).toLocaleString()} ₭
          </p>
        </div>

        {/* Net Profit */}
        <div className={`p-4 sm:p-5 rounded-3xl border space-y-1 ${
          financialOverview.netProfit >= 0 
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
        }`}>
          <span className="text-[9.5px] font-black uppercase block">
            {i18n.language === 'la' ? 'ກຳໄລສຸດທິ (Net Profit)' : 'Net Profit'}
          </span>
          <p className="text-xl font-black font-mono">
            {Math.round(financialOverview.netProfit).toLocaleString()} ₭
          </p>
          <p className="text-[9px] opacity-80 font-bold uppercase">
            Est. ROI: {financialOverview.estimatedROI.toFixed(1)}%
          </p>
        </div>

        {/* OPEX */}
        <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
          <span className="text-[9.5px] font-black uppercase text-slate-400 block">
            {i18n.language === 'la' ? 'ຄ່າໃຊ້ຈ່າຍດຳເນີນງານ (OPEX)' : 'Operating Expenses'}
          </span>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.totalOPEX).toLocaleString()} ₭
          </p>
          <p className="text-[9px] text-slate-400 font-bold uppercase">
            Rent, Salary, Utilities
          </p>
        </div>

      </div>

      {/* ================= 3. PAYMENT CHANNELS ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Cashflow */}
        <div className="bg-gradient-to-br from-[#052659] to-[#073069] text-white p-5 rounded-3xl shadow-xl space-y-2 relative overflow-hidden">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#5483B3]">
              {i18n.language === 'la' ? 'ຍອດເງິນຄົງເຫຼືອລວມທັງໝົດ' : 'Total Net Cashflow'}
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 bg-white/10 rounded-full font-bold">
              {financialOverview.transactionCount} Tx
            </span>
          </div>
          <p className="text-2xl font-black font-mono tracking-tight">
            {Math.round(financialOverview.totalNetLiquidity).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-blue-200/70 font-bold uppercase">
            <span>↗ Inflow: +{Math.round(financialOverview.totalRevenue).toLocaleString()}</span>
            <span>↘ Outflow: -{Math.round(financialOverview.totalExpenses).toLocaleString()}</span>
          </div>
        </div>

        {/* Cash In Hand */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ເງິນສົດໃນມື (Cash)' : 'Cash in Hand'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded font-bold">Cash</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.cashNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
            <span className="text-emerald-500">+{Math.round(financialOverview.cashIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.cashExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* BCEL OnePay */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>BCEL OnePay</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded font-bold">OnePay</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.onepayNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
            <span className="text-emerald-500">+{Math.round(financialOverview.onepayIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.onepayExpense).toLocaleString()}</span>
          </div>
        </div>

        {/* LDB Bank */}
        <div className="bg-white dark:bg-[#073069] p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{i18n.language === 'la' ? 'ທະນາຄານ LDB' : 'LDB Balance'}</span>
            </span>
            <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded font-bold">LDB</span>
          </div>
          <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
            {Math.round(financialOverview.ldbNet).toLocaleString()} ₭
          </p>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold font-mono">
            <span className="text-emerald-500">+{Math.round(financialOverview.ldbIncome).toLocaleString()}</span>
            <span className="text-red-500">-{Math.round(financialOverview.ldbExpense).toLocaleString()}</span>
          </div>
        </div>

      </div>

      {/* ================= 4. INSIGHTS & 7-DAY INFLOW/OUTFLOW ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* SMART BUSINESS INSIGHTS (5 Cols) */}
        <div className="lg:col-span-5 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3 mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
                <span>{i18n.language === 'la' ? 'ບົດວິເຄາະ & Insights ສຳຄັນ' : 'Executive Business Insights'}</span>
              </h3>
              <span className="text-[8.5px] font-black uppercase tracking-widest px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                AI Advisory
              </span>
            </div>

            <div className="space-y-3">
              {smartInsights.map(insight => (
                <div
                  key={insight.id}
                  className={`p-3.5 rounded-2xl border space-y-1 transition-all ${
                    insight.type === 'warning'
                      ? 'bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-300'
                      : insight.type === 'success'
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-300'
                        : 'bg-blue-500/5 border-blue-500/20 text-blue-900 dark:text-blue-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      insight.type === 'warning' ? 'bg-amber-500' : insight.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}></div>
                    <h4 className="text-[11px] font-black uppercase tracking-tight">
                      {i18n.language === 'la' ? insight.titleLa : insight.titleEn}
                    </h4>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed font-medium pl-3">
                    {i18n.language === 'la' ? insight.descLa : insight.descEn}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-between items-center text-[10px] text-slate-400 font-bold">
            <span>{i18n.language === 'la' ? 'ສິນຄ້າທັງໝົດ:' : 'Active Items:'} {inventoryOverview.totalProducts}</span>
            <span className={inventoryOverview.lowStockCount > 0 ? 'text-amber-500' : 'text-emerald-500'}>
              {inventoryOverview.lowStockCount} {i18n.language === 'la' ? 'ໃກ້ໝົດ' : 'Critical'}
            </span>
          </div>
        </div>

        {/* 7-DAY INFLOW VS OUTFLOW CHART (7 Cols) */}
        <div className="lg:col-span-7 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4 flex flex-col justify-between">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ກະແສເງິນສົດ 7 ວັນລ່າສຸດ' : '7-Day Cashflow Trends'}</span>
            </h3>
            <div className="flex gap-3 text-[9px] font-black uppercase">
              <span className="flex items-center gap-1 text-emerald-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Inflow
              </span>
              <span className="flex items-center gap-1 text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> Outflow
              </span>
            </div>
          </div>

          <div className="h-[220px] w-full" style={{ minWidth: 100 }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={financialOverview.trends7Days}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="date" tick={{fontSize: 9}} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#052659', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                  formatter={(val: number) => [`${Number(val || 0).toLocaleString()} ₭`, '']}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ================= 5. STOCK HEALTH & RECENT LOGS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* STOCK HEALTH (6 Cols) */}
        <div className="lg:col-span-6 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ສະຖານະສະຕັອກສິນຄ້າ (Stock Health)' : 'Inventory Stock Health'}</span>
            </h3>
            <button
              onClick={() => setShowInventoryModal(true)}
              className="text-[9px] font-black uppercase text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              View Full
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {inventoryOverview.stockHealth.slice(0, 6).map(item => (
              <div key={item.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{item.name}</p>
                  <p className="text-[9px] text-slate-400 uppercase font-bold mt-0.5">
                    Min: {item.minStock} {item.unit}
                  </p>
                </div>

                <div className="text-right flex items-center gap-3">
                  <p className="text-xs font-mono font-black text-slate-800 dark:text-white">
                    {item.current} <span className="text-[9px] text-slate-400 uppercase">{item.unit}</span>
                  </p>
                  <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                    item.status === 'Critical' ? 'bg-red-500 text-white' : item.status === 'Warning' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT TRANSACTIONS (6 Cols) */}
        <div className="lg:col-span-6 high-density-card bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <span>{i18n.language === 'la' ? 'ທຸລະກຳລ່າສຸດ (Recent Transactions)' : 'Recent Transactions'}</span>
            </h3>
            <span className="text-[9px] font-bold text-slate-400">
              {fsTransactions.length} logs
            </span>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {fsTransactions.slice(0, 6).map(tx => {
              const isIncome = tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales';
              const ch = normalizePayment(tx.source);

              return (
                <div key={tx.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 flex justify-between items-center">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-7 rounded-full ${isIncome ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate max-w-[160px]">
                        {tx.category || 'Transaction'}
                      </p>
                      <p className="text-[9px] text-slate-400 font-medium">
                        {toStandardDate(tx.date || tx.createdAt)} • {tx.time || ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                      ch === 'Cash' ? 'bg-emerald-500/10 text-emerald-600' : ch === 'Onepay' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {ch}
                    </span>
                    <p className={`text-xs font-mono font-black ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {isIncome ? '+' : '-'}{parseAmount(tx.amount).toLocaleString()} ₭
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* INVENTORY MODAL */}
      {showInventoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-white/10 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-500" />
                <span>Full Inventory Status</span>
              </h3>
              <button type="button" onClick={() => setShowInventoryModal(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl cursor-pointer">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Search items..."
                className="w-full h-10 px-3 pl-8 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <Search className="absolute left-2.5 top-3 w-4 h-4 text-slate-400" />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {inventoryOverview.stockHealth
                .filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(item => (
                  <div key={item.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{item.name}</p>
                      <p className="text-[9px] text-slate-400 uppercase">Min: {item.minStock} {item.unit}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-black">{item.current} {item.unit}</span>
                      <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                        item.status === 'Critical' ? 'bg-red-500 text-white' : item.status === 'Warning' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
