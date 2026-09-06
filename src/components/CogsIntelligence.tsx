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
  Link2, Check, Download, Zap, Sparkles, CheckCheck,
  CheckSquare, Square, Filter, ChevronLeft, ChevronRight,
  Plus, Settings, Tags, X
} from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

// ຊື່ເດືອນພາສາລາວ ແລະ ອັງກິດ
const LAO_MONTHS = [
  'ມັງກອນ (Jan)', 'ກຸມພາ (Feb)', 'ມີນາ (Mar)', 'ເມສາ (Apr)', 
  'ພຶດສະພາ (May)', 'ມິຖຸນາ (Jun)', 'ກໍລະກົດ (Jul)', 'ສິງຫາ (Aug)', 
  'ກັນຍາ (Sep)', 'ຕຸລາ (Oct)', 'ພະຈິກ (Nov)', 'ທັນວາ (Dec)'
];

// 🇱🇦 ລະບົບຕັດວັນນະຍຸດ + ຕັດຂະໜາດຕົວເລກອອກ (Lao Deep Normalizer)
export const normalizeLaoDeep = (str: string): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    // ຕັດວັນນະຍຸດລາວ & ໄທ
    .replace(/[\u0EC8-\u0ECC\u0E48-\u0E4C]/g, '')
    // ຕັດຄຳບອກຂະໜາດທົ່ວໄປເຊັ່ນ: 95mm, 98mm, 16oz, 22oz, 500g, 1kg
    .replace(/\b(\d+mm|\d+oz|\d+g|\d+kg|\d+ml|\d+l)\b/g, '')
    // ຕັດຕົວເລກ ແລະ ເຄື່ອງໝາຍພິເສດ
    .replace(/[0-9\-_./\\()[\]]/g, '')
    .replace(/\s+/g, '')
    .trim();
};

interface PhysicalCountRow {
  fullUnits: number;
  partialPercent: number;
}

interface CustomCategory {
  id: string;
  name: string;
  isCogs: boolean; // ເລືອກວ່ານັບເຂົ້າ COGS ຫຼື ບໍ່
}

const DEFAULT_CATEGORIES: CustomCategory[] = [
  { id: 'raw_material', name: 'ວັດຖຸດິບ (Raw Material)', isCogs: true },
  { id: 'packaging', name: 'ບັນຈຸພັນ (Packaging)', isCogs: true },
  { id: 'operating', name: 'ສິ້ນເປືອງ (Operating/OPEX)', isCogs: false },
  { id: 'asset', name: 'ອຸປະກອນ (Equipment/Assets)', isCogs: false }
];

export default function CogsIntelligence({ selectedBranch }: { selectedBranch?: string; userSettings?: any }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  const [activeTab, setActiveTab] = useState<'stocktake' | 'sku_mapping'>('stocktake');

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, any>>({});
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(DEFAULT_CATEGORIES);

  const [saving, setSaving] = useState(false);
  const [mappingUpdatingId, setMappingUpdatingId] = useState<string | null>(null);
  const [autoMatchingLoading, setAutoMatchingLoading] = useState(false);

  // Modal ຈັດການກຸ່ມສິນຄ້າ
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIsCogs, setNewCatIsCogs] = useState(true);

  // ປະຕິທິນ: ເລືອກເດືອນ (Date Object)
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const selectedMonth = useMemo(() => format(currentDate, 'yyyy-MM'), [currentDate]);

  // Filters
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(`cogs_selected_items_${currentBranch}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [mappingFilter, setMappingFilter] = useState<'all' | 'unmapped' | 'mapped'>('unmapped');
  const [inputSkus, setInputSkus] = useState<Record<string, string>>({});
  const [searchItem, setSearchItem] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, PhysicalCountRow>>({});

  // 1. ດຶງຂໍ້ມູນ Real-time + Categories ຈາກ Firestore
  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'products'), snap => {
      const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProducts(prods);

      setSelectedProductIds(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const initialMap: Record<string, boolean> = {};
        prods.forEach(p => {
          const catName = String(p.category || '').toLowerCase();
          initialMap[p.id] = !catName.includes('asset') && !catName.includes('operating') && !catName.includes('opex');
        });
        return initialMap;
      });
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

    // ດຶງ Custom Categories
    const unsubC = onSnapshot(doc(db, 'settings', 'cogs_categories'), snap => {
      if (snap.exists() && snap.data().categories) {
        setCustomCategories(snap.data().categories);
      }
    });

    return () => {
      unsubP();
      unsubS();
      unsubT();
      unsubM();
      unsubC();
    };
  }, [currentBranch]);

  // 2. ດຶງຂໍ້ມູນການກວດນັບຂອງເດືອນທີ່ເລືອກ
  useEffect(() => {
    async function loadMonthlyStockCount() {
      try {
        const docRef = doc(db, 'monthly_stock_counts', `${currentBranch}_${selectedMonth}`);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          setPhysicalCounts(data.counts || {});
          if (data.selectedProductIds) {
            setSelectedProductIds(data.selectedProductIds);
          }
        } else {
          setPhysicalCounts({});
        }
      } catch (err) {
        console.error('Error loading monthly stock count:', err);
      }
    }
    loadMonthlyStockCount();
  }, [currentBranch, selectedMonth]);

  // 3. ປຸ່ມປ່ຽນເດືອນ (ປະຕິທິນ)
  const handlePrevMonth = () => setCurrentDate(prev => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentDate(prev => addMonths(prev, 1));

  // 4. ຈັດການກຸ່ມສິນຄ້າ (Custom Categories)
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const newCat: CustomCategory = {
      id: `cat_${Date.now()}`,
      name: newCatName.trim(),
      isCogs: newCatIsCogs
    };
    const updated = [...customCategories, newCat];
    setCustomCategories(updated);
    await setDoc(doc(db, 'settings', 'cogs_categories'), { categories: updated }, { merge: true });
    setNewCatName('');
  };

  const handleDeleteCategory = async (catId: string) => {
    const updated = customCategories.filter(c => c.id !== catId);
    setCustomCategories(updated);
    await setDoc(doc(db, 'settings', 'cogs_categories'), { categories: updated }, { merge: true });
  };

  // ປ່ຽນກຸ່ມຂອງສິນຄ້າໂດຍກົງໃນຕາຕະລາງ
  const handleUpdateProductCategory = async (productId: string, newCategoryName: string) => {
    try {
      await updateDoc(doc(db, 'products', productId), {
        category: newCategoryName
      });
      // ຖ້າກຸ່ມໃໝ່ຖືກຕັ້ງວ່າບໍ່ແມ່ນ COGS ໃຫ້ຕິກອອກອັດຕະໂນມັດ
      const matchedCat = customCategories.find(c => c.name === newCategoryName);
      if (matchedCat) {
        setSelectedProductIds(prev => {
          const next = { ...prev, [productId]: matchedCat.isCogs };
          localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
          return next;
        });
      }
    } catch (err: any) {
      alert('Error updating category: ' + err.message);
    }
  };

  // 5. ລວມລາຍການສິນຄ້າຈາກບິນ Supplier + ລະບົບ Cross-Supplier Suggestion
  const distinctSupplierItems = useMemo(() => {
    const map: Record<string, {
      rawId: string;
      rawName: string;
      supplier: string;
      totalPurchasedCount: number;
      totalSpendLAK: number;
      currentSku?: string;
      suggestedSku?: string;
      suggestedSource?: string;
    }> = {};

    // ສ້າງວັດຈະນານຸກົມຊື່ທີ່ເຄີຍຈັບຄູ່ແລ້ວ (Knowledge Base)
    const existingNameMap: Record<string, string> = {};
    Object.values(skuMappings).forEach((m: any) => {
      if (m.rawName && m.targetSku) {
        existingNameMap[normalizeLaoDeep(m.rawName)] = m.targetSku;
      }
    });

    supplierPrices.forEach(sp => {
      const rawId = sp.productId || 'unknown';
      const supplier = sp.supplier || 'Unknown';
      const key = `${supplier}_${rawId}`;
      const safeKey = key.replace(/[\/\s]/g, '_');

      const totalVal = sp.totalPriceLAK !== undefined
        ? Number(sp.totalPriceLAK || 0)
        : (Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);

      if (!map[key]) {
        const matchedOldProd = products.find(p => p.id === rawId);
        const rawName = matchedOldProd?.name || sp.remark || rawId;
        const currentSku = sp.sku || skuMappings[safeKey]?.targetSku || skuMappings[key]?.targetSku || matchedOldProd?.sku || '';

        // 🌟 ຊອກຫາ ຄຳແນະນຳ (Suggested SKU) ທີ່ສະຫຼາດຂຶ້ນ:
        let suggestedSku = '';
        let suggestedSource = '';

        if (!currentSku) {
          const deepNormRaw = normalizeLaoDeep(rawName);

          // 1) ຊອກຫາຈາກຮ້ານອື່ນທີ່ເຄີຍຈັບຄູ່ໄປແລ້ວ (ເຊັ່ນ ຮ້ານ A ເຄີຍໃສ່ "ຝາໂດມ" ແລ້ວ)
          if (existingNameMap[deepNormRaw]) {
            suggestedSku = existingNameMap[deepNormRaw];
            suggestedSource = 'ເຄີຍຈັບຄູ່ຈາກຮ້ານອື່ນ';
          } 
          // 2) ຊອກຫາຈາກ Inventory Products
          else {
            const foundMatch = products.find(p => {
              const deepNormP = normalizeLaoDeep(p.name);
              return deepNormP && (deepNormRaw === deepNormP || deepNormRaw.includes(deepNormP) || deepNormP.includes(deepNormRaw));
            });
            if (foundMatch && foundMatch.sku) {
              suggestedSku = foundMatch.sku;
              suggestedSource = foundMatch.name;
            }
          }
        }

        map[key] = {
          rawId,
          rawName,
          supplier,
          totalPurchasedCount: 0,
          totalSpendLAK: 0,
          currentSku,
          suggestedSku,
          suggestedSource
        };
      }

      map[key].totalPurchasedCount += 1;
      map[key].totalSpendLAK += totalVal;
    });

    return Object.values(map);
  }, [supplierPrices, products, skuMappings]);

  const unlinkedCount = useMemo(() => {
    return distinctSupplierItems.filter(item => !item.currentSku).length;
  }, [distinctSupplierItems]);

  // 6. ບັນທຶກ SKU
  const handleSaveSkuMapping = async (supplierKey: string, rawId: string, supplier: string, rawName: string, customSkuToSave?: string) => {
    const targetSku = (customSkuToSave !== undefined 
      ? customSkuToSave 
      : (inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (skuMappings[supplierKey.replace(/[\/\s]/g, '_')]?.targetSku || ''))
    ).trim();

    if (!targetSku) {
      alert('ກະລຸນາພິມເລກ SKU ກ່ອນກົດບັນທຶກ!');
      return;
    }

    try {
      setMappingUpdatingId(supplierKey);

      let targetProduct = products.find(p => (p.sku || '').toLowerCase() === targetSku.toLowerCase());
      if (!targetProduct) {
        try {
          const newProdRef = await addDoc(collection(db, 'products'), {
            name: rawName || targetSku,
            sku: targetSku,
            unit: 'UNIT',
            category: 'ວັດຖຸດິບ (Raw Material)',
            cost: 0,
            isApproved: true,
            createdAt: serverTimestamp()
          });
          targetProduct = { id: newProdRef.id, name: rawName, sku: targetSku, unit: 'UNIT' };
        } catch {
          targetProduct = { id: rawId, name: rawName, sku: targetSku, unit: 'UNIT' };
        }
      }

      const safeDocId = supplierKey.replace(/[\/\s]/g, '_');
      await setDoc(doc(db, 'sku_mappings', safeDocId), {
        supplierKey,
        rawId,
        rawName,
        supplier,
        targetSku,
        productId: targetProduct.id,
        productName: targetProduct.name,
        updatedAt: serverTimestamp()
      });

      try {
        const matchingBills = supplierPrices.filter(sp => (sp.productId === rawId || sp.id === rawId) && sp.supplier === supplier);
        for (const bill of matchingBills) {
          await updateDoc(doc(db, 'supplierPrices', bill.id), {
            sku: targetSku,
            mappedProductId: targetProduct.id
          });
        }
      } catch {}

      alert(`✅ ບັນທຶກ SKU "${targetSku}" ສຳເລັດ!`);
    } catch (err: any) {
      alert('Error updating SKU: ' + err.message);
    } finally {
      setMappingUpdatingId(null);
    }
  };

  // ⚡ ນຳໃຊ້ SKU ນີ້ກັບທຸກຮ້ານທີ່ຂຽນຄືກັນ (ເຊັ່ນ ຝາໂດມ)
  const handleApplyToAllSimilar = async (sourceRawName: string, targetSku: string) => {
    if (!targetSku) return;
    const deepNormSource = normalizeLaoDeep(sourceRawName);
    if (!deepNormSource) return;

    if (!window.confirm(`ຕ້ອງການນຳໃຊ້ SKU "${targetSku}" ໃຫ້ກັບທຸກຮ້ານທີ່ມີຄຳວ່າ "${sourceRawName}" ແທ້ບໍ່?`)) {
      return;
    }

    try {
      setAutoMatchingLoading(true);
      const similarItems = distinctSupplierItems.filter(item => {
        const deepNorm = normalizeLaoDeep(item.rawName);
        return deepNorm && (deepNorm === deepNormSource || deepNorm.includes(deepNormSource) || deepNormSource.includes(deepNorm));
      });

      for (const item of similarItems) {
        const key = `${item.supplier}_${item.rawId}`;
        const safeDocId = key.replace(/[\/\s]/g, '_');

        await setDoc(doc(db, 'sku_mappings', safeDocId), {
          supplierKey: key,
          rawId: item.rawId,
          rawName: item.rawName,
          supplier: item.supplier,
          targetSku,
          updatedAt: serverTimestamp()
        });
      }

      alert(`🎉 ສຳເລັດ! ໄດ້ນຳໃຊ້ SKU "${targetSku}" ໃຫ້ກັບ ${similarItems.length} ລາຍການຮຽບຮ້ອຍ!`);
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setAutoMatchingLoading(false);
    }
  };

  // ⚡ Auto-Match All (ຈັບຄູ່ອັດຕະໂນມັດ)
  const handleSmartAutoMatchAll = async () => {
    try {
      setAutoMatchingLoading(true);
      let matchedCount = 0;

      for (const item of distinctSupplierItems) {
        if (item.currentSku) continue;
        const deepNormRaw = normalizeLaoDeep(item.rawName);
        if (!deepNormRaw) continue;

        const matchedProd = products.find(p => {
          const deepNormP = normalizeLaoDeep(p.name);
          return deepNormP && (deepNormRaw === deepNormP || deepNormRaw.includes(deepNormP) || deepNormP.includes(deepNormRaw));
        });

        if (matchedProd && matchedProd.sku) {
          const key = `${item.supplier}_${item.rawId}`;
          const safeDocId = key.replace(/[\/\s]/g, '_');

          await setDoc(doc(db, 'sku_mappings', safeDocId), {
            supplierKey: key,
            rawId: item.rawId,
            rawName: item.rawName,
            supplier: item.supplier,
            targetSku: matchedProd.sku,
            productId: matchedProd.id,
            productName: matchedProd.name,
            updatedAt: serverTimestamp()
          });

          matchedCount++;
        }
      }

      alert(`🎉 ລະບົບຈັບຄູ່ອັດຕະໂນມັດສຳເລັດ ${matchedCount} ລາຍການ!`);
    } catch (err: any) {
      alert('Auto-match error: ' + err.message);
    } finally {
      setAutoMatchingLoading(false);
    }
  };

  // 7. ຄິດໄລ່ WAC & Actual COGS
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
      const safeKey = rawKey.replace(/[\/\s]/g, '_');
      const resolvedSku = (
        sp.sku || 
        skuMappings[safeKey]?.targetSku || 
        skuMappings[rawKey]?.targetSku || 
        products.find(p => p.id === sp.productId)?.sku || 
        ''
      ).trim();

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
    let totalSelectedItemsCount = 0;

    const roster = products.map(p => {
      const isSelected = selectedProductIds[p.id] !== false;
      const skuKey = (p.sku || p.id).trim();
      const ledger = skuLedger[skuKey];
      const count = physicalCounts[p.id] || { fullUnits: 0, partialPercent: 0 };
      
      const fullUnits = Number(count.fullUnits) || 0;
      const partialPercent = Math.min(100, Math.max(0, Number(count.partialPercent) || 0));
      
      const effectiveRemainingQty = fullUnits + (partialPercent / 100);
      const wacCost = ledger?.wac || 0;
      const endingValue = effectiveRemainingQty * wacCost;

      if (isSelected) {
        totalEndingInventoryValue += endingValue;
        totalPurchasesThisMonth += ledger?.monthPurchasedValue || 0;
        totalSelectedItemsCount++;
      }

      return {
        id: p.id,
        sku: p.sku || '-',
        name: p.name,
        category: p.category || 'ວັດຖຸດິບ (Raw Material)',
        unit: p.unit || 'UNIT',
        fullUnits,
        partialPercent,
        effectiveRemainingQty,
        wacCost,
        monthPurchasedValue: ledger?.monthPurchasedValue || 0,
        endingValue,
        isSelected
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
      roster,
      totalSelectedItemsCount
    };
  }, [products, supplierPrices, transactions, selectedMonth, physicalCounts, skuMappings, selectedProductIds]);

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
        selectedProductIds,
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
    const headers = ['Active COGS', 'SKU', 'Product', 'Category', 'Unit', 'Full Units', 'Partial %', 'Total Remaining', 'WAC (LAK)', 'Ending Value (LAK)'];
    const rows = calculationResults.roster.map(r => [
      r.isSelected ? 'YES' : 'NO',
      r.sku,
      r.name,
      r.category,
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

      {/* Header Bar + ປະຕິທິນລາວ-ອັງກິດ */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {i18n.language === 'la' ? 'ສະຫຼຸບຕົ້ນທຶນ COGS & ຈັບຄູ່ SKU' : 'COGS Intelligence & SKU Hub'}
            </h2>
            
            {/* 🌟 ປະຕິທິນ 2 ພາສາ (Lao - English Calendar Picker) */}
            <div className="flex items-center gap-2 mt-1">
              <button 
                onClick={handlePrevMonth}
                className="p-1 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-600 dark:text-white cursor-pointer"
                title="ເດືອນກ່ອນໜ້າ"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 dark:bg-white/5 border border-indigo-500/20 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-300">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {LAO_MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                </span>
              </div>

              <button 
                onClick={handleNextMonth}
                className="p-1 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-600 dark:text-white cursor-pointer"
                title="ເດືອນຖັດໄປ"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ປຸ່ມສະຫຼັບແທັບ + ປຸ່ມຈັດການກຸ່ມ */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCategoryModal(true)}
            className="px-3.5 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-white text-xs font-black uppercase rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            <Tags className="w-3.5 h-3.5 text-indigo-500" />
            <span>ຈັດການກຸ່ມສິນຄ້າ</span>
          </button>

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
              <span>2. ປ້ອນ / ຈັບຄູ່ SKU</span>
              {unlinkedCount > 0 && (
                <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-white animate-pulse">
                  {unlinkedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

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
                <Package className="w-3.5 h-3.5 text-blue-500" /> Purchases (ສະເພາະກຸ່ມ COGS)
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
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-white/10 space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    placeholder="ຄົ້ນຫາ SKU ຫຼື ຊື່ສິນຄ້າ..."
                    value={searchItem}
                    onChange={e => setSearchItem(e.target.value)}
                    className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
                  />
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
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

              {/* 🌟 ປຸ່ມຄວບຄຸມການຕິກເລືອກ + Filter ຕາມກຸ່ມ */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    ຄິດໄລ່ COGS: <strong className="text-indigo-600 dark:text-indigo-400">{calculationResults.totalSelectedItemsCount}</strong> / {products.length} ລາຍການ
                  </span>
                  <div className="h-3 w-[1px] bg-slate-200 dark:bg-white/10"></div>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      products.forEach(p => next[p.id] = true);
                      setSelectedProductIds(next);
                      localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
                    }}
                    className="text-[10px] font-black uppercase text-indigo-500 hover:text-indigo-600 cursor-pointer"
                  >
                    [ຕິກເລືອກທັງໝົດ]
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      products.forEach(p => next[p.id] = false);
                      setSelectedProductIds(next);
                      localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
                    }}
                    className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    [ຍົກເລີກທັງໝົດ]
                  </button>
                </div>

                {/* Filter ຕາມໝວດໝູ່ທີ່ສ້າງໄວ້ */}
                <div className="flex items-center gap-1 overflow-x-auto">
                  <Filter className="w-3 h-3 text-slate-400 mr-1" />
                  <button
                    onClick={() => setCategoryFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all ${
                      categoryFilter === 'all' 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    ທັງໝົດ
                  </button>
                  {customCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.name)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all ${
                        categoryFilter === cat.name 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
                  <tr>
                    <th className="p-3.5 text-center w-12">COGS</th>
                    <th className="p-3.5">SKU / ລາຍການສິນຄ້າ</th>
                    <th className="p-3.5 w-48">ກຸ່ມສິນຄ້າ (Category)</th>
                    <th className="p-3.5 text-right">ລາຄາ WAC ຕໍ່ໜ່ວຍ</th>
                    <th className="p-3.5 text-center w-36">ຈຳນວນເຕັມ (Full Units)</th>
                    <th className="p-3.5 text-center w-32">ເຫຼືອເປັນ % (0-100%)</th>
                    <th className="p-3.5 text-right">ລວມຈຳນວນເຫຼືອ</th>
                    <th className="p-3.5 text-right">ມູນຄ່າເຫຼືອຕົວຈິງ (LAK)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {calculationResults.roster
                    .filter(r => {
                      const matchSearch = r.name.toLowerCase().includes(searchItem.toLowerCase()) || r.sku.toLowerCase().includes(searchItem.toLowerCase());
                      const matchCat = categoryFilter === 'all' || r.category.toLowerCase() === categoryFilter.toLowerCase();
                      return matchSearch && matchCat;
                    })
                    .map(item => (
                      <tr 
                        key={item.id} 
                        className={`transition-all ${
                          item.isSelected 
                            ? 'hover:bg-slate-50 dark:hover:bg-white/5' 
                            : 'opacity-40 bg-slate-100/40 dark:bg-black/20'
                        }`}
                      >
                        <td className="p-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductIds(prev => {
                                const next = { ...prev, [item.id]: !prev[item.id] };
                                localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
                                return next;
                              });
                            }}
                            className="text-indigo-600 dark:text-indigo-400 cursor-pointer"
                          >
                            {item.isSelected ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                            )}
                          </button>
                        </td>

                        <td className="p-3.5">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono text-[9px] font-black mr-2">
                            {item.sku}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-white">{item.name}</span>
                          {!item.isSelected && (
                            <span className="ml-2 text-[9px] text-slate-400 font-bold uppercase">[ບໍ່ຄິດໄລ່ COGS]</span>
                          )}
                        </td>

                        {/* 🌟 Dropdown ເລືອກກຸ່ມສິນຄ້າໂດຍກົງໃນຕາຕະລາງ */}
                        <td className="p-3.5">
                          <select
                            value={item.category}
                            onChange={e => handleUpdateProductCategory(item.id, e.target.value)}
                            className="h-7 px-2 text-[10px] font-bold rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 outline-none cursor-pointer w-full"
                          >
                            {customCategories.map(cat => (
                              <option key={cat.id} value={cat.name}>
                                {cat.name} {cat.isCogs ? '(COGS)' : '(Non-COGS)'}
                              </option>
                            ))}
                          </select>
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
      {/* ແທັບທີ 2: ສູນປ້ອນ / ຈັບຄູ່ SKU ດ້ວຍຕົນເອງ (SMART SKU HUB) */}
      {/* ======================================================== */}
      {activeTab === 'sku_mapping' && (
        <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl overflow-hidden space-y-4">
          <div className="p-5 border-b border-slate-100 dark:border-white/10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-indigo-500" />
                  <span>ສູນຈັບຄູ່ SKU ອັດສະລິຍະ (Smart SKU Matching Hub)</span>
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase">
                  🇱🇦 Lao Deep Stripper Active
                </span>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-0.5">
                ຈັບຄູ່ສິນຄ້າຂ້າມຮ້ານອັດຕະໂນມັດ (ເຊັ່ນ: ຝາໂດມ 95mm = ຝາໂດມປາກ95 = ຝາໂດມ).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              {/* 🌟 ປຸ່ມ Filter ສະເພາະທີ່ຍັງບໍ່ທັນຈັບຄູ່ */}
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl text-[10px] font-black uppercase">
                <button
                  onClick={() => setMappingFilter('unmapped')}
                  className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${mappingFilter === 'unmapped' ? 'bg-amber-500 text-white' : 'text-slate-500'}`}
                >
                  ຍັງບໍ່ທັນຈັບຄູ່ ({unlinkedCount})
                </button>
                <button
                  onClick={() => setMappingFilter('all')}
                  className={`px-3 py-1 rounded-lg cursor-pointer transition-all ${mappingFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                >
                  ທັງໝົດ ({distinctSupplierItems.length})
                </button>
              </div>

              <div className="relative flex-1 lg:w-56">
                <input
                  type="text"
                  placeholder="ຄົ້ນຫາ Supplier ຫຼື ສິນຄ້າ..."
                  value={mappingSearch}
                  onChange={e => setMappingSearch(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
                />
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              </div>

              <button
                type="button"
                disabled={autoMatchingLoading}
                onClick={handleSmartAutoMatchAll}
                className="h-9 px-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{autoMatchingLoading ? '...' : '⚡ Auto-Match ທັງໝົດ'}</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
                <tr>
                  <th className="p-3.5">Supplier</th>
                  <th className="p-3.5">ລາຍການສິນຄ້າໃນບິນຈັດຊື້</th>
                  <th className="p-3.5 text-center">ຈຳນວນບິນ</th>
                  <th className="p-3.5 w-80">ພິມເລກ SKU / ຕົວຊ່ວຍ</th>
                  <th className="p-3.5 text-center">ສະຖານະ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {distinctSupplierItems
                  .filter(item => {
                    const matchSearch = item.supplier.toLowerCase().includes(mappingSearch.toLowerCase()) || item.rawName.toLowerCase().includes(mappingSearch.toLowerCase());
                    const matchFilter = mappingFilter === 'all' ? true : (mappingFilter === 'unmapped' ? !item.currentSku : !!item.currentSku);
                    return matchSearch && matchFilter;
                  })
                  .map(item => {
                    const supplierKey = `${item.supplier}_${item.rawId}`;
                    const currentVal = inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (item.currentSku || '');
                    const isLinked = !!item.currentSku;

                    return (
                      <tr key={supplierKey} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                        <td className="p-3.5 font-bold uppercase text-slate-500">
                          {item.supplier}
                        </td>
                        
                        <td className="p-3.5">
                          <p className="font-bold text-slate-800 dark:text-white">{item.rawName}</p>
                          
                          {/* 🌟 ປ້າຍແນະນຳ SKU ທີ່ສະຫຼາດຂຶ້ນ (ແນະນຳຈາກຮ້ານອື່ນທີ່ເຄີຍໃສ່ໄວ້) */}
                          {!isLinked && item.suggestedSku && (
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[9.5px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-bold">
                                <Sparkles className="w-3 h-3" />
                                ແນະນຳ: <strong className="font-mono bg-amber-500/10 px-1 py-0.5 rounded">{item.suggestedSku}</strong> ({item.suggestedSource})
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSaveSkuMapping(supplierKey, item.rawId, item.supplier, item.rawName, item.suggestedSku)}
                                className="px-2 py-0.5 bg-amber-500 text-white rounded text-[9px] font-black uppercase cursor-pointer shadow-xs hover:bg-amber-600"
                              >
                                [ໃຊ້ເລກນີ້ທັນທີ]
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="p-3.5 text-center font-mono">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-[10px] font-bold">
                            {item.totalPurchasedCount} ບິນ
                          </span>
                        </td>

                        {/* ✍️ ຊ່ອງພິມ SKU + ປຸ່ມບັນທຶກ + ປຸ່ມນຳໃຊ້ກັບທຸກຮ້ານ */}
                        <td className="p-3.5">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={currentVal}
                                placeholder="ຕົວຢ່າງ: LID-DOME-95"
                                onChange={(e) => setInputSkus(prev => ({ ...prev, [supplierKey]: e.target.value }))}
                                className="h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none focus:border-indigo-500 w-full"
                              />
                              <button
                                type="button"
                                disabled={mappingUpdatingId === supplierKey}
                                onClick={() => handleSaveSkuMapping(supplierKey, item.rawId, item.supplier, item.rawName)}
                                className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                                title="ບັນທຶກສະເພາະຮ້ານນີ້"
                              >
                                <Save className="w-3 h-3" />
                                <span>{mappingUpdatingId === supplierKey ? '...' : 'ບັນທຶກ'}</span>
                              </button>
                            </div>

                            {/* ⚡ ປຸ່ມນຳໃຊ້ກັບທຸກຮ້ານທີ່ມີຊື່ຄ້າຍຄືກັນ (ເຊັ່ນ ຝາໂດມ) */}
                            {currentVal && (
                              <button
                                type="button"
                                onClick={() => handleApplyToAllSimilar(item.rawName, currentVal)}
                                className="text-[9.5px] text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1 cursor-pointer transition-all"
                              >
                                <CheckCheck className="w-3 h-3" />
                                <span>ໃຊ້ SKU "{currentVal}" ກັບທຸກຮ້ານທີ່ມີຊື່ "{item.rawName}"</span>
                              </button>
                            )}
                          </div>
                        </td>

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

      {/* ======================================================== */}
      {/* 🌟 MODAL ຈັດການກຸ່ມສິນຄ້າ (CATEGORY / GROUP MANAGER) */}
      {/* ======================================================== */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Tags className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ຈັດການກຸ່ມສິນຄ້າ (COGS Category Manager)
                </h3>
              </div>
              <button 
                onClick={() => setShowCategoryModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-300">
              ກຸ່ມທີ່ຖືກຕັ້ງຄ່າວ່າ <strong>Active COGS (Yes)</strong> ຈະຖືກດຶງມານັບເຂົ້າໃນຍອດຕົ້ນທຶນຕົວຈິງທຸກໆເດືອນອັດຕະໂນມັດ:
            </p>

            {/* ຟອມສ້າງກຸ່ມໃໝ່ */}
            <div className="p-3.5 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-2.5 border border-slate-200 dark:border-white/10">
              <span className="text-[10px] font-black uppercase text-slate-400">ສ້າງກຸ່ມໃໝ່</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="ຊື່ກຸ່ມ (ເຊັ່ນ: ວັດຖຸດິບ, Packaging, ສິ້ນເປືອງ...)"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none"
                />
                <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer text-slate-700 dark:text-white">
                  <input
                    type="checkbox"
                    checked={newCatIsCogs}
                    onChange={e => setNewCatIsCogs(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span>ນັບເຂົ້າ COGS</span>
                </label>
                <button
                  onClick={handleAddCategory}
                  className="px-3.5 h-9 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> ເພີ່ມ
                </button>
              </div>
            </div>

            {/* ລາຍການກຸ່ມທີ່ມີໃນປັດຈຸບັນ */}
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {customCategories.map(cat => (
                <div 
                  key={cat.id}
                  className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-white/5"
                >
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-white">{cat.name}</p>
                    <span className={`text-[9.5px] font-black uppercase ${cat.isCogs ? 'text-emerald-500' : 'text-slate-400'}`}>
                      {cat.isCogs ? '✓ ນັບເຂົ້າ COGS (Active in COGS)' : '✗ ບໍ່ນັບເຂົ້າ COGS (Non-COGS)'}
                    </span>
                  </div>
                  {customCategories.length > 1 && (
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="p-1.5 text-red-400 hover:text-red-500 rounded-lg cursor-pointer"
                      title="ລຶບກຸ່ມນີ້"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/10">
              <button
                onClick={() => setShowCategoryModal(false)}
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
