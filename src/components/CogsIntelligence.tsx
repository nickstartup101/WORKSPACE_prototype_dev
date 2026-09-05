import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, onSnapshot, doc, setDoc, updateDoc, addDoc,
  serverTimestamp, getDoc 
} from 'firebase/firestore';
import { 
  Scale, Calculator, Save, 
  Calendar, Search, Percent, Package, 
  ArrowUpRight, ArrowDownRight, Info, AlertTriangle, 
  Link2, Check, Download, Plus
} from 'lucide-react';
import { format } from 'date-fns';
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

interface PhysicalCountRow {
  fullUnits: number;
  partialPercent: number;
}

export default function CogsIntelligence({ selectedBranch }: { selectedBranch?: string; userSettings?: any }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  // ແທັບ: 1. ກວດນັບສະຕັອກ & COGS | 2. ສູນຈັບຄູ່ SKU
  const [activeTab, setActiveTab] = useState<'stocktake' | 'sku_mapping'>('stocktake');

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [mappingUpdatingId, setMappingUpdatingId] = useState<string | null>(null);

  // State ສຳລັບເກັບຄ່າ SKU ທີ່ກຳລັງພິມໃນແຕ່ລະແຖວ
  const [inputSkus, setInputSkus] = useState<Record<string, string>>({});

  // ເລືອກເດືອນທີ່ຈະສະຫຼຸບ (Format: YYYY-MM)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => format(new Date(), 'yyyy-MM'));
  const [searchItem, setSearchItem] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');

  // ຂໍ້ມູນການກວດນັບຕົວຈິງທ້າຍເດືອນ
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, PhysicalCountRow>>({});

  // 1. ດຶງຂໍ້ມູນ Real-time ຈາກ Firestore
  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'products'));

    const unsubS = onSnapshot(collection(db, 'supplierPrices'), snap => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.LIST, 'supplierPrices'));

    const unsubT = onSnapshot(collection(db, 'transactions'), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(all.filter((tx: any) => (tx.branchId || 'branch_1') === currentBranch));
    }, err => handleFirestoreError(err, OperationType.LIST, 'transactions'));

    const unsubM = onSnapshot(collection(db, 'sku_mappings'), snap => {
      const mapData: Record<string, any> = {};
      snap.docs.forEach(d => { mapData[d.id] = d.data(); });
      setSkuMappings(mapData);
    });

    return () => {
      unsubP();
      unsubS();
      unsubT();
      unsubM();
    };
  }, [currentBranch]);

  // 2. ດຶງຂໍ້ມູນການກວດນັບຂອງເດືອນທີ່ເລືອກ
  useEffect(() => {
    async function loadMonthlyStockCount() {
      try {
        const docRef = doc(db, 'monthly_stock_counts', `${currentBranch}_${selectedMonth}`);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setPhysicalCounts(snap.data().counts || {});
        } else {
          setPhysicalCounts({});
        }
      } catch (err) {
        console.error('Error loading monthly stock count:', err);
      }
    }
    loadMonthlyStockCount();
  }, [currentBranch, selectedMonth]);

  // 3. ລວມລາຍການສິນຄ້າຈາກບິນ Supplier ເພື່ອນຳມາພິມຈັບຄູ່ SKU
  const distinctSupplierItems = useMemo(() => {
    const map: Record<string, {
      rawId: string;
      rawName: string;
      supplier: string;
      totalPurchasedCount: number;
      totalSpendLAK: number;
      currentSku?: string;
    }> = {};

    supplierPrices.forEach(sp => {
      const rawId = sp.productId || 'unknown';
      const supplier = sp.supplier || 'Unknown';
      const key = `${supplier}_${rawId}`;

      const totalVal = sp.totalPriceLAK !== undefined
        ? Number(sp.totalPriceLAK || 0)
        : (Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);

      if (!map[key]) {
        const matchedOldProd = products.find(p => p.id === rawId);
        map[key] = {
          rawId,
          rawName: matchedOldProd?.name || sp.remark || rawId,
          supplier,
          totalPurchasedCount: 0,
          totalSpendLAK: 0,
          currentSku: sp.sku || skuMappings[key]?.targetSku || matchedOldProd?.sku || ''
        };
      }

      map[key].totalPurchasedCount += 1;
      map[key].totalSpendLAK += totalVal;
    });

    return Object.values(map);
  }, [supplierPrices, products, skuMappings]);

  // ຈຳນວນລາຍການທີ່ຍັງບໍ່ທັນມີ SKU
  const unlinkedCount = useMemo(() => {
    return distinctSupplierItems.filter(item => !item.currentSku).length;
  }, [distinctSupplierItems]);

  // 4. ບັນທຶກ SKU (ຂຽນເອງ + ສ້າງສິນຄ້າໃນ Inventory ອັດຕະໂນມັດຖ້າຍັງບໍ່ມີ)
  const handleSaveSkuMapping = async (supplierKey: string, rawId: string, supplier: string, rawName: string) => {
    const targetSku = (inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (skuMappings[supplierKey]?.targetSku || '')).trim();
    if (!targetSku) {
      alert('ກະລຸນາພິມເລກ SKU ກ່ອນກົດບັນທຶກ!');
      return;
    }

    try {
      setMappingUpdatingId(supplierKey);

      // ກວດເບິ່ງວ່າມີສິນຄ້າທີ່ມີ SKU ນີ້ໃນ Inventory ແລ້ວຫຼືຍັງ
      let targetProduct = products.find(p => (p.sku || '').toLowerCase() === targetSku.toLowerCase());

      // 🌟 ຖ້າຍັງບໍ່ມີໃນ Inventory -> ສ້າງສິນຄ້າໃໝ່ລົງ `products` ອັດຕະໂນມັດທັນທີ!
      if (!targetProduct) {
        const newProdRef = await addDoc(collection(db, 'products'), {
          name: rawName || targetSku,
          sku: targetSku,
          unit: 'UNIT',
          category: 'Raw Material',
          cost: 0,
          isApproved: true,
          createdAt: serverTimestamp()
        });
        targetProduct = { id: newProdRef.id, name: rawName, sku: targetSku, unit: 'UNIT' };
      }

      // 1. ບັນທຶກລົງ `sku_mappings`
      await setDoc(doc(db, 'sku_mappings', supplierKey), {
        supplierKey,
        rawId,
        supplier,
        targetSku,
        productId: targetProduct.id,
        productName: targetProduct.name,
        updatedAt: serverTimestamp()
      });

      // 2. ອັບເດດບິນເກົ່າທັງໝົດຂອງ Supplier ນີ້ໃຫ້ມີ SKU ດຽວກັນ
      const matchingBills = supplierPrices.filter(sp => (sp.productId === rawId || sp.id === rawId) && sp.supplier === supplier);
      for (const bill of matchingBills) {
        await updateDoc(doc(db, 'supplierPrices', bill.id), {
          sku: targetSku,
          mappedProductId: targetProduct.id
        });
      }

      alert(`✅ ບັນທຶກ SKU "${targetSku}" ສຳເລັດ! (ອັບເດດບິນເກົ່າ ${matchingBills.length} ບິນ ແລະ ເພີ່ມລົງ Inventory ຮຽບຮ້ອຍ)`);
    } catch (err: any) {
      alert('Error updating SKU: ' + err.message);
    } finally {
      setMappingUpdatingId(null);
    }
  };

  // 5. ຄິດໄລ່ WAC & Actual COGS ອີງຕາມ SKU
  const calculationResults = useMemo(() => {
    const monthStart = `${selectedMonth}-01`;
    const monthEnd = `${selectedMonth}-31`;

    let monthRevenue = 0;
    transactions.forEach(tx => {
      const d = toStandardDate(tx.date || tx.createdAt);
      if (d >= monthStart && d <= monthEnd) {
        if (tx.type === 'income' || String(tx.category || '').toLowerCase() === 'sales') {
          monthRevenue += Number(tx.amount || 0);
        }
      }
    });

    const skuLedger: Record<string, {
      product: any;
      totalPurchasedQty: number;
      totalPurchasedValue: number;
      monthPurchasedQty: number;
      monthPurchasedValue: number;
      wac: number;
    }> = {};

    products.forEach(p => {
      const skuKey = (p.sku || p.id).trim();
      skuLedger[skuKey] = {
        product: p,
        totalPurchasedQty: 0,
        totalPurchasedValue: 0,
        monthPurchasedQty: 0,
        monthPurchasedValue: 0,
        wac: 0
      };
    });

    supplierPrices.forEach(sp => {
      const rawKey = `${sp.supplier}_${sp.productId}`;
      const resolvedSku = (sp.sku || skuMappings[rawKey]?.targetSku || products.find(p => p.id === sp.productId)?.sku || '').trim();

      if (!resolvedSku || !skuLedger[resolvedSku]) return;

      const qty = Number(sp.quantity) || 1;
      const totalVal = sp.totalPriceLAK !== undefined
        ? Number(sp.totalPriceLAK || 0)
        : (Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * qty;

      const ledger = skuLedger[resolvedSku];
      ledger.totalPurchasedQty += qty;
      ledger.totalPurchasedValue += totalVal;

      const pDate = toStandardDate(sp.date || sp.createdAt);
      if (pDate >= monthStart && pDate <= monthEnd) {
        ledger.monthPurchasedQty += qty;
        ledger.monthPurchasedValue += totalVal;
      }
    });

    Object.values(skuLedger).forEach(ledger => {
      if (ledger.totalPurchasedQty > 0) {
        ledger.wac = ledger.totalPurchasedValue / ledger.totalPurchasedQty;
      } else {
        ledger.wac = Number(ledger.product.cost || 0);
      }
    });

    let totalEndingInventoryValue = 0;
    let totalPurchasesThisMonth = 0;

    const roster = products.map(p => {
      const skuKey = (p.sku || p.id).trim();
      const ledger = skuLedger[skuKey];
      const count = physicalCounts[p.id] || { fullUnits: 0, partialPercent: 0 };
      
      const fullUnits = Number(count.fullUnits) || 0;
      const partialPercent = Math.min(100, Math.max(0, Number(count.partialPercent) || 0));
      
      const effectiveRemainingQty = fullUnits + (partialPercent / 100);
      const wacCost = ledger?.wac || 0;
      const endingValue = effectiveRemainingQty * wacCost;

      totalEndingInventoryValue += endingValue;
      totalPurchasesThisMonth += ledger?.monthPurchasedValue || 0;

      return {
        id: p.id,
        sku: p.sku || '-',
        name: p.name,
        unit: p.unit || 'UNIT',
        fullUnits,
        partialPercent,
        effectiveRemainingQty,
        wacCost,
        monthPurchasedValue: ledger?.monthPurchasedValue || 0,
        endingValue
      };
    });

    const actualCogs = Math.max(0, totalPurchasesThisMonth - totalEndingInventoryValue);
    const grossProfit = monthRevenue - actualCogs;
    const grossMargin = monthRevenue > 0 ? (grossProfit / monthRevenue) * 100 : 0;
    const cogsRatio = monthRevenue > 0 ? (actualCogs / monthRevenue) * 100 : 0;

    return {
      monthRevenue,
      totalPurchasesThisMonth,
      totalEndingInventoryValue,
      actualCogs,
      grossProfit,
      grossMargin,
      cogsRatio,
      roster
    };
  }, [products, supplierPrices, transactions, selectedMonth, physicalCounts, skuMappings]);

  const handleCountChange = (productId: string, field: 'fullUnits' | 'partialPercent', value: string) => {
    const num = parseFloat(value) || 0;
    setPhysicalCounts(prev => ({
      ...prev,
      [productId]: {
        fullUnits: field === 'fullUnits' ? num : (prev[productId]?.fullUnits || 0),
        partialPercent: field === 'partialPercent' ? num : (prev[productId]?.partialPercent || 0),
      }
    }));
  };

  const handleSaveCounts = async () => {
    try {
      setSaving(true);
      const docRef = doc(db, 'monthly_stock_counts', `${currentBranch}_${selectedMonth}`);
      await setDoc(docRef, {
        branchId: currentBranch,
        month: selectedMonth,
        counts: physicalCounts,
        summary: {
          revenue: calculationResults.monthRevenue,
          purchases: calculationResults.totalPurchasesThisMonth,
          endingValuation: calculationResults.totalEndingInventoryValue,
          actualCogs: calculationResults.actualCogs
        },
        updatedAt: serverTimestamp()
      });
      alert(i18n.language === 'la' ? `ບັນທຶກສະຕັອກທ້າຍເດືອນ ${selectedMonth} ສຳເລັດ!` : `Saved!`);
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportExcel = () => {
    const headers = ['SKU', 'Product', 'Unit', 'Full Units', 'Partial %', 'Total Remaining', 'WAC (LAK)', 'Ending Value (LAK)'];
    const rows = calculationResults.roster.map(r => [
      r.sku,
      r.name,
      r.unit,
      r.fullUnits,
      `${r.partialPercent}%`,
      r.effectiveRemainingQty.toFixed(2),
      Math.round(r.wacCost),
      Math.round(r.endingValue)
    ]);
    const ws = utils.aoa_to_sheet([headers, ...rows]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `Stock_${selectedMonth}`);
    writeFile(wb, `StockCount_${selectedMonth}.xlsx`);
  };

  return (
    <div className="space-y-6">

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {i18n.language === 'la' ? 'ສະຫຼຸບຕົ້ນທຶນ COGS & ຈັບຄູ່ SKU' : 'COGS Intelligence & SKU Hub'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              End-of-Month Stocktake & Supplier SKU Mapping
            </p>
          </div>
        </div>

        {/* ປຸ່ມສະຫຼັບແທັບ */}
        <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('stocktake')}
            className={`px-4 py-2 text-xs font-black uppercase rounded-xl transition-all cursor-pointer ${
              activeTab === 'stocktake' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            1. ກວດນັບສະຕັອກ & COGS
          </button>
          <button
            onClick={() => setActiveTab('sku_mapping')}
            className={`px-4 py-2 text-xs font-black uppercase rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'sku_mapping' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>2. ປ້ອນ / ຈັບຄູ່ SKU ({distinctSupplierItems.length})</span>
            {unlinkedCount > 0 && (
              <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-white animate-pulse">
                {unlinkedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ແຈ້ງເຕືອນຖ້າມີລາຍການຍັງບໍ່ທັນມີ SKU */}
      {unlinkedCount > 0 && activeTab === 'stocktake' && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-slate-700 dark:text-slate-200">
              ພົບເຫັນ <strong className="text-amber-600 dark:text-amber-400">{unlinkedCount} ລາຍການ</strong> ຈາກ Supplier ທີ່ຍັງບໍ່ທັນໄດ້ໃສ່ SKU.
            </span>
          </div>
          <button
            onClick={() => setActiveTab('sku_mapping')}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase cursor-pointer"
          >
            ໄປໃສ່ເລກ SKU ດຽວນີ້
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* ແທັບທີ 1: ກວດນັບສະຕັອກທ້າຍເດືອນ & ຄິດໄລ່ ACTUAL COGS */}
      {/* ======================================================== */}
      {activeTab === 'stocktake' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
              <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> Revenue
              </span>
              <p className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {Math.round(calculationResults.monthRevenue).toLocaleString()} ₭
              </p>
            </div>

            <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
              <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Package className="w-3.5 h-3.5 text-blue-500" /> Purchases (ຊື້ເຂົ້າ)
              </span>
              <p className="text-xl font-black font-mono text-slate-800 dark:text-white">
                {Math.round(calculationResults.totalPurchasesThisMonth).toLocaleString()} ₭
              </p>
            </div>

            <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
              <span className="text-[9.5px] font-black uppercase text-indigo-500 flex items-center gap-1">
                <Calculator className="w-3.5 h-3.5" /> Ending Stock (ຄັງເຫຼືອ)
              </span>
              <p className="text-xl font-black font-mono text-indigo-600 dark:text-indigo-400">
                {Math.round(calculationResults.totalEndingInventoryValue).toLocaleString()} ₭
              </p>
            </div>

            <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1">
              <span className="text-[9.5px] font-black uppercase text-rose-500 flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5" /> Actual COGS
              </span>
              <p className="text-xl font-black font-mono text-rose-600 dark:text-rose-400">
                {Math.round(calculationResults.actualCogs).toLocaleString()} ₭
              </p>
            </div>

            <div className="bg-white dark:bg-[#073069] p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-1 col-span-2 lg:col-span-1">
              <span className="text-[9.5px] font-black uppercase text-slate-400 flex items-center gap-1">
                <Percent className="w-3.5 h-3.5 text-amber-500" /> COGS %
              </span>
              <p className="text-xl font-black font-mono text-amber-600 dark:text-amber-400">
                {calculationResults.cogsRatio.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* ຕາຕະລາງກວດນັບສະຕັອກ */}
          <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-white/10 flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10">
                  <Calendar className="w-4 h-4 text-indigo-500" />
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                    className="bg-transparent text-xs font-bold outline-none cursor-pointer text-slate-800 dark:text-white"
                  />
                </div>
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="ຄົ້ນຫາ SKU ຫຼື ຊື່ສິນຄ້າ..."
                    value={searchItem}
                    onChange={e => setSearchItem(e.target.value)}
                    className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
                  />
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportExcel}
                  className="px-3 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-xs font-black uppercase rounded-xl flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-white"
                >
                  <Download className="w-3.5 h-3.5" /> Export Excel
                </button>
                <button
                  onClick={handleSaveCounts}
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'SAVING...' : 'ບັນທຶກສະຕັອກ'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
                  <tr>
                    <th className="p-3.5">SKU / ລາຍການສິນຄ້າ</th>
                    <th className="p-3.5 text-right">ລາຄາ WAC ຕໍ່ໜ່ວຍ</th>
                    <th className="p-3.5 text-center w-36">ຈຳນວນເຕັມ (Full Units)</th>
                    <th className="p-3.5 text-center w-32">ເຫຼືອເປັນ % (0-100%)</th>
                    <th className="p-3.5 text-right">ລວມຈຳນວນເຫຼືອ</th>
                    <th className="p-3.5 text-right">ມູນຄ່າເຫຼືອຕົວຈິງ (LAK)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {calculationResults.roster
                    .filter(r => r.name.toLowerCase().includes(searchItem.toLowerCase()) || r.sku.toLowerCase().includes(searchItem.toLowerCase()))
                    .map(item => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                        <td className="p-3.5">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono text-[9px] font-black mr-2">
                            {item.sku}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-white">{item.name}</span>
                        </td>
                        
                        <td className="p-3.5 text-right font-mono font-bold text-slate-600 dark:text-slate-300">
                          {Math.round(item.wacCost).toLocaleString()} ₭ / {item.unit}
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={physicalCounts[item.id]?.fullUnits ?? ''}
                              placeholder="0"
                              onChange={e => handleCountChange(item.id, 'fullUnits', e.target.value)}
                              className="w-20 h-8 px-2 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg outline-none focus:border-indigo-500"
                            />
                            <span className="text-[9px] text-slate-400 uppercase">{item.unit}</span>
                          </div>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={physicalCounts[item.id]?.partialPercent ?? ''}
                              placeholder="0"
                              onChange={e => handleCountChange(item.id, 'partialPercent', e.target.value)}
                              className="w-16 h-8 px-2 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg outline-none focus:border-indigo-500"
                            />
                            <span className="text-xs font-bold text-slate-400">%</span>
                          </div>
                        </td>

                        <td className="p-3.5 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {item.effectiveRemainingQty.toFixed(2)} {item.unit}
                        </td>

                        <td className="p-3.5 text-right font-mono font-black text-slate-900 dark:text-white">
                          {Math.round(item.endingValue).toLocaleString()} ₭
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ແທັບທີ 2: ສູນປ້ອນ / ຈັບຄູ່ SKU ດ້ວຍຕົນເອງ (CUSTOM SKU INPUT) */}
      {/* ======================================================== */}
      {activeTab === 'sku_mapping' && (
        <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl overflow-hidden space-y-4">
          <div className="p-5 border-b border-slate-100 dark:border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                <Link2 className="w-4 h-4 text-indigo-500" />
                <span>ສູນປ້ອນ / ຈັບຄູ່ເລກ SKU ສິນຄ້າ (Supplier ➔ Inventory SKU)</span>
              </h3>
              <p className="text-[10.5px] text-slate-400 mt-0.5">
                ທ່ານສາມາດ<strong>ພິມເລກ SKU ໃສ່ເອງໄດ້ໂດຍກົງ</strong>. ຖ້າ SKU ໃດຍັງບໍ່ມີໃນ Inventory ລະບົບຈະສ້າງສິນຄ້າໃໝ່ລົງຄັງ ແລະ ອັບເດດບິນເກົ່າໃຫ້ທັນທີ!
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="ຄົ້ນຫາ Supplier ຫຼື ສິນຄ້າ..."
                value={mappingSearch}
                onChange={e => setMappingSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
              />
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
                <tr>
                  <th className="p-3.5">Supplier</th>
                  <th className="p-3.5">ລາຍການສິນຄ້າໃນບິນຈັດຊື້</th>
                  <th className="p-3.5 text-center">ຈຳນວນບິນທີ່ຊື້</th>
                  <th className="p-3.5 w-72">ພິມເລກ SKU (ປ້ອນດ້ວຍຕົນເອງ)</th>
                  <th className="p-3.5 text-center">ສະຖານະ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {distinctSupplierItems
                  .filter(item => 
                    item.supplier.toLowerCase().includes(mappingSearch.toLowerCase()) || 
                    item.rawName.toLowerCase().includes(mappingSearch.toLowerCase())
                  )
                  .map(item => {
                    const supplierKey = `${item.supplier}_${item.rawId}`;
                    const currentVal = inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (item.currentSku || '');
                    const isLinked = !!item.currentSku;

                    return (
                      <tr key={supplierKey} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                        <td className="p-3.5 font-bold uppercase text-slate-500">
                          {item.supplier}
                        </td>
                        
                        <td className="p-3.5 font-bold text-slate-800 dark:text-white">
                          {item.rawName}
                        </td>

                        <td className="p-3.5 text-center font-mono">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-[10px] font-bold">
                            {item.totalPurchasedCount} ບິນ
                          </span>
                        </td>

                        {/* ✍️ ຊ່ອງພິມ SKU ເອງ + ປຸ່ມບັນທຶກ */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={currentVal}
                              placeholder="ຕົວຢ່າງ: MILK-01"
                              onChange={(e) => setInputSkus(prev => ({ ...prev, [supplierKey]: e.target.value }))}
                              className="h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none focus:border-indigo-500 w-full"
                            />
                            <button
                              type="button"
                              disabled={mappingUpdatingId === supplierKey}
                              onClick={() => handleSaveSkuMapping(supplierKey, item.rawId, item.supplier, item.rawName)}
                              className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <Save className="w-3 h-3" />
                              <span>{mappingUpdatingId === supplierKey ? '...' : 'ບັນທຶກ'}</span>
                            </button>
                          </div>
                        </td>

                        {/* ສະຖານະການຈັບຄູ່ */}
                        <td className="p-3.5 text-center">
                          {isLinked ? (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[9.5px] font-mono inline-flex items-center gap-1">
                              <Check className="w-3 h-3" /> {item.currentSku}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-[9.5px] uppercase inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> ຍັງບໍ່ມີ SKU
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
