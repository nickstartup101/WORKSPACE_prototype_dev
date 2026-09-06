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

interface PhysicalCountRow {
  fullUnits: number;
  partialPercent: number;
}

// 🌟 ໂຄງສ້າງກົດເກນ Prefix ຂອງ SKU
interface SkuPrefixRule {
  id: string;
  prefix: string;   // ຕົວອັກສອນຂຶ້ນຕົ້ນ ເຊັ່ນ: P, S, O, EQ
  name: string;     // ຊື່ກຸ່ມ ເຊັ່ນ: ວັດຖຸດິບ, Packaging
  isCogs: boolean;  // ນັບເຂົ້າ COGS ຫຼື ບໍ່
}

const DEFAULT_SKU_RULES: SkuPrefixRule[] = [
  { id: 'rule_p', prefix: 'P', name: 'ວັດຖຸດິບ (Raw Material)', isCogs: true },
  { id: 'rule_s', prefix: 'S', name: 'ບັນຈຸພັນ (Packaging)', isCogs: true },
  { id: 'rule_o', prefix: 'O', name: 'ສິ້ນເປືອງ (Operating/OPEX)', isCogs: false },
  { id: 'rule_eq', prefix: 'EQ', name: 'ອຸປະກອນ (Equipment)', isCogs: false }
];

export default function CogsIntelligence({ selectedBranch }: { selectedBranch?: string; userSettings?: any }) {
  const { i18n } = useTranslation();
  const currentBranch = selectedBranch || 'branch_1';

  // 🛡️ ຟັງຊັນແປງວັນທີປອດໄພ
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

  // 🛡️ ຟັງຊັນປົດວັນນະຍຸດລາວ
  const normalizeLaoDeep = (str: any): string => {
    if (!str || typeof str !== 'string') return '';
    try {
      return str
        .toLowerCase()
        .replace(/[\u0EC8-\u0ECC\u0E48-\u0E4C]/g, '')
        .replace(/\b(\d+mm|\d+oz|\d+g|\d+kg|\d+ml|\d+l)\b/g, '')
        .replace(/[0-9\-_./\\()[\]]/g, '')
        .replace(/\s+/g, '')
        .trim();
    } catch {
      return '';
    }
  };

  const [activeTab, setActiveTab] = useState<'stocktake' | 'sku_mapping'>('stocktake');

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, any>>({});
  const [skuRules, setSkuRules] = useState<SkuPrefixRule[]>(DEFAULT_SKU_RULES);

  const [saving, setSaving] = useState(false);
  const [mappingUpdatingId, setMappingUpdatingId] = useState<string | null>(null);
  const [autoMatchingLoading, setAutoMatchingLoading] = useState(false);

  // Modal ຈັດການກົດເກນ SKU
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [newPrefix, setNewPrefix] = useState('');
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleIsCogs, setNewRuleIsCogs] = useState(true);

  // ປະຕິທິນ: ເລືອກເດືອນ
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

  const [skuPrefixFilter, setSkuPrefixFilter] = useState<string>('all');
  const [mappingFilter, setMappingFilter] = useState<'all' | 'unmapped' | 'mapped'>('unmapped');
  const [inputSkus, setInputSkus] = useState<Record<string, string>>({});
  const [searchItem, setSearchItem] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, PhysicalCountRow>>({});

  // 🌟 ຟັງຊັນຈັດກຸ່ມອັດຕະໂນມັດຈາກເລກ SKU
  const classifySku = (skuStr: string): { groupName: string; isCogs: boolean; prefix: string } => {
    const clean = String(skuStr || '').trim().toUpperCase();
    if (!clean) return { groupName: 'ຍັງບໍ່ມີ SKU', isCogs: false, prefix: '' };

    // ຮຽງຕາມຄວາມຍາວຂອງ Prefix ເພື່ອໃຫ້ກົງຈຸດທີ່ສຸດ (ເຊັ່ນ: EQ ມາກ່ອນ E)
    const sorted = [...skuRules].sort((a, b) => b.prefix.length - a.prefix.length);
    const matched = sorted.find(r => clean.startsWith(r.prefix.toUpperCase()));

    if (matched) {
      return { groupName: matched.name, isCogs: matched.isCogs, prefix: matched.prefix };
    }
    return { groupName: 'ອື່ນໆ (General)', isCogs: false, prefix: 'OTHER' };
  };

  // 1. ດຶງຂໍ້ມູນ Real-time + SKU Rules ຈາກ Firestore
  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'products'), snap => {
      const prods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProducts(prods);

      setSelectedProductIds(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const initialMap: Record<string, boolean> = {};
        prods.forEach(p => {
          const info = classifySku(String(p.sku || ''));
          initialMap[p.id] = info.isCogs;
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

    const unsubR = onSnapshot(doc(db, 'settings', 'cogs_sku_rules'), snap => {
      if (snap.exists() && Array.isArray(snap.data()?.rules)) {
        setSkuRules(snap.data().rules);
      }
    }, () => {});

    return () => {
      unsubP();
      unsubS();
      unsubT();
      unsubM();
      unsubR();
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

  const handlePrevMonth = () => setCurrentDate(prev => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentDate(prev => addMonths(prev, 1));

  // 3. ຈັດການກົດເກນ SKU (Prefix Rules)
  const handleAddSkuRule = async () => {
    const cleanPref = newPrefix.trim().toUpperCase();
    const cleanName = newRuleName.trim();
    if (!cleanPref || !cleanName) return;

    const newRule: SkuPrefixRule = {
      id: `rule_${Date.now()}`,
      prefix: cleanPref,
      name: cleanName,
      isCogs: newRuleIsCogs
    };

    const updated = [...skuRules.filter(r => r.prefix !== cleanPref), newRule];
    setSkuRules(updated);
    try {
      await setDoc(doc(db, 'settings', 'cogs_sku_rules'), { rules: updated }, { merge: true });
    } catch {}

    // ອັບເດດການຕິກ COGS ທັນທີ
    setSelectedProductIds(prev => {
      const next = { ...prev };
      products.forEach(p => {
        const info = classifySku(String(p.sku || ''));
        next[p.id] = info.isCogs;
      });
      localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
      return next;
    });

    setNewPrefix('');
    setNewRuleName('');
  };

  const handleDeleteSkuRule = async (ruleId: string) => {
    const updated = skuRules.filter(r => r.id !== ruleId);
    setSkuRules(updated);
    try {
      await setDoc(doc(db, 'settings', 'cogs_sku_rules'), { rules: updated }, { merge: true });
    } catch {}
  };

  // 4. ລວມລາຍການສິນຄ້າຈາກບິນ Supplier + ຄຳແນະນຳຂ້າມຮ້ານ
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

    const existingNameMap: Record<string, string> = {};
    Object.values(skuMappings || {}).forEach((m: any) => {
      if (m && m.rawName && m.targetSku) {
        const norm = normalizeLaoDeep(String(m.rawName));
        if (norm) existingNameMap[norm] = String(m.targetSku);
      }
    });

    (supplierPrices || []).forEach(sp => {
      const rawId = String(sp.productId || 'unknown');
      const supplier = String(sp.supplier || 'Unknown');
      const key = `${supplier}_${rawId}`;
      const safeKey = key.replace(/[\/\s]/g, '_');

      const totalVal = sp.totalPriceLAK !== undefined
        ? Number(sp.totalPriceLAK || 0)
        : (Number(sp.priceOriginal || 0) * Number(sp.exchangeRate || 1)) * (Number(sp.quantity) || 1);

      if (!map[key]) {
        const matchedOldProd = products.find(p => p.id === rawId);
        const rawName = String(matchedOldProd?.name || sp.remark || rawId);
        const currentSku = String(sp.sku || skuMappings[safeKey]?.targetSku || skuMappings[key]?.targetSku || matchedOldProd?.sku || '');

        let suggestedSku = '';
        let suggestedSource = '';

        if (!currentSku) {
          const deepNormRaw = normalizeLaoDeep(rawName);
          if (deepNormRaw && existingNameMap[deepNormRaw]) {
            suggestedSku = existingNameMap[deepNormRaw];
            suggestedSource = 'ເຄີຍຈັບຄູ່ຈາກຮ້ານອື່ນ';
          } else if (deepNormRaw) {
            const foundMatch = products.find(p => {
              const deepNormP = normalizeLaoDeep(String(p?.name || ''));
              return deepNormP && (deepNormRaw === deepNormP || deepNormRaw.includes(deepNormP) || deepNormP.includes(deepNormRaw));
            });
            if (foundMatch && foundMatch.sku) {
              suggestedSku = String(foundMatch.sku);
              suggestedSource = String(foundMatch.name || 'Inventory');
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

  const handleSaveSkuMapping = async (supplierKey: string, rawId: string, supplier: string, rawName: string, customSkuToSave?: string) => {
    const targetSku = String(customSkuToSave !== undefined 
      ? customSkuToSave 
      : (inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (skuMappings[supplierKey.replace(/[\/\s]/g, '_')]?.targetSku || ''))
    ).trim().toUpperCase();

    if (!targetSku) {
      alert('ກະລຸນາພິມເລກ SKU ກ່ອນກົດບັນທຶກ!');
      return;
    }

    try {
      setMappingUpdatingId(supplierKey);

      // ກຳນົດກຸ່ມອັດຕະໂນມັດຕາມ SKU
      const autoGroup = classifySku(targetSku);

      let targetProduct = products.find(p => String(p?.sku || '').toUpperCase() === targetSku);
      if (!targetProduct) {
        try {
          const newProdRef = await addDoc(collection(db, 'products'), {
            name: rawName || targetSku,
            sku: targetSku,
            unit: 'UNIT',
            category: autoGroup.groupName,
            cost: 0,
            isApproved: true,
            createdAt: serverTimestamp()
          });
          targetProduct = { id: newProdRef.id, name: rawName, sku: targetSku, unit: 'UNIT', category: autoGroup.groupName };
        } catch {
          targetProduct = { id: rawId, name: rawName, sku: targetSku, unit: 'UNIT', category: autoGroup.groupName };
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

      // ຕັ້ງຄ່າ COGS ອັດຕະໂນມັດຕາມ SKU
      setSelectedProductIds(prev => {
        const next = { ...prev, [targetProduct.id]: autoGroup.isCogs };
        localStorage.setItem(`cogs_selected_items_${currentBranch}`, JSON.stringify(next));
        return next;
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

      alert(`✅ ບັນທຶກ SKU "${targetSku}" ສຳເລັດ! ຈັດເຂົ້າກຸ່ມ "${autoGroup.groupName}"`);
    } catch (err: any) {
      alert('Error updating SKU: ' + err.message);
    } finally {
      setMappingUpdatingId(null);
    }
  };

  const handleApplyToAllSimilar = async (sourceRawName: string, targetSku: string) => {
    if (!targetSku) return;
    const cleanSku = targetSku.trim().toUpperCase();
    const deepNormSource = normalizeLaoDeep(sourceRawName);
    if (!deepNormSource) return;

    if (!window.confirm(`ຕ້ອງການນຳໃຊ້ SKU "${cleanSku}" ໃຫ້ກັບທຸກຮ້ານທີ່ມີຄຳວ່າ "${sourceRawName}" ແທ້ບໍ່?`)) {
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
          targetSku: cleanSku,
          updatedAt: serverTimestamp()
        });
      }

      alert(`🎉 ສຳເລັດ! ໄດ້ນຳໃຊ້ SKU "${cleanSku}" ໃຫ້ກັບ ${similarItems.length} ລາຍການຮຽບຮ້ອຍ!`);
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setAutoMatchingLoading(false);
    }
  };

  const handleSmartAutoMatchAll = async () => {
    try {
      setAutoMatchingLoading(true);
      let matchedCount = 0;

      for (const item of distinctSupplierItems) {
        if (item.currentSku) continue;
        const deepNormRaw = normalizeLaoDeep(item.rawName);
        if (!deepNormRaw) continue;

        const matchedProd = products.find(p => {
          const deepNormP = normalizeLaoDeep(String(p?.name || ''));
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
            targetSku: String(matchedProd.sku).toUpperCase(),
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

  // 5. ຄິດໄລ່ WAC & Actual COGS
  const calculationResults = useMemo(() => {
    const monthStart = `${selectedMonth}-01`;
    const monthEnd = `${selectedMonth}-31`;

    let monthRevenue = 0;
    (transactions || []).forEach(tx => {
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

    (products || []).forEach(p => {
      const skuKey = String(p?.sku || p?.id || '').trim().toUpperCase();
      skuLedger[skuKey] = {
        product: p,
        totalPurchasedQty: 0,
        totalPurchasedValue: 0,
        monthPurchasedQty: 0,
        monthPurchasedValue: 0,
        wac: 0
      };
    });

    (supplierPrices || []).forEach(sp => {
      const rawKey = `${sp.supplier}_${sp.productId}`;
      const safeKey = rawKey.replace(/[\/\s]/g, '_');
      const resolvedSku = String(
        sp.sku || 
        skuMappings[safeKey]?.targetSku || 
        skuMappings[rawKey]?.targetSku || 
        products.find(p => p.id === sp.productId)?.sku || 
        ''
      ).trim().toUpperCase();

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
        ledger.wac = Number(ledger.product?.cost || 0);
      }
    });

    let totalEndingInventoryValue = 0;
    let totalPurchasesThisMonth = 0;
    let totalSelectedItemsCount = 0;

    const roster = (products || []).map(p => {
      const skuStr = String(p?.sku || '').trim().toUpperCase();
      const skuInfo = classifySku(skuStr);

      // 🌟 ຕັດສິນໃຈວ່າລາຍການນີ້ຖືກຕິກ COGS ບໍ່ (ອີງຕາມກົດເກນ SKU ຫຼື Checkbox)
      const isSelected = selectedProductIds[p.id] !== undefined ? selectedProductIds[p.id] : skuInfo.isCogs;

      const skuKey = skuStr || String(p?.id || '').trim();
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
        sku: skuStr || '-',
        prefix: skuInfo.prefix,
        groupName: skuInfo.groupName,
        name: p.name || 'Unnamed',
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

    // ຈັດລຽງໃຫ້ SKU ຮຽງຕາມກຸ່ມຢ່າງສວຍງາມ (P ມາກ່ອນ, ຕາມດ້ວຍ S, O...)
    roster.sort((a, b) => a.sku.localeCompare(b.sku));

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
  }, [products, supplierPrices, transactions, selectedMonth, physicalCounts, skuMappings, selectedProductIds, skuRules]);

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
    const headers = ['Active COGS', 'SKU', 'Product', 'Group (SKU Rule)', 'Unit', 'Full Units', 'Partial %', 'Total Remaining', 'WAC (LAK)', 'Ending Value (LAK)'];
    const rows = calculationResults.roster.map(r => [
      r.isSelected ? 'YES' : 'NO',
      r.sku,
      r.name,
      r.groupName,
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
              {i18n.language === 'la' ? 'ສະຫຼຸບຕົ້ນທຶນ COGS & ຈັດກຸ່ມຕາມ SKU' : 'COGS Intelligence & SKU Architecture'}
            </h2>
            
            {/* ປະຕິທິນ 2 ພາສາ */}
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

        {/* ປຸ່ມສະຫຼັບແທັບ + ປຸ່ມຕັ້ງຄ່າກົດເກນ SKU */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowRuleModal(true)}
            className="px-3.5 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 text-slate-700 dark:text-white text-xs font-black uppercase rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-500" />
            <span>ກຳນົດກົດເກນ SKU ({skuRules.length})</span>
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

          {/* ຕາຕະລາງກວດນັບສະຕັອກ + Filter ຕາມໝວດ SKU */}
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

              {/* 🌟 Filter ຕາມ Prefix ຂອງ SKU (ເຊັ່ນ: ໝວດ P, ໝວດ S, ໝວດ O...) */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    ນັບເຂົ້າ COGS: <strong className="text-indigo-600 dark:text-indigo-400">{calculationResults.totalSelectedItemsCount}</strong> / {products.length} ລາຍການ
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
                    [ຕິກທັງໝົດ]
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

                {/* ປຸ່ມກັ່ນຕອງໝວດ SKU */}
                <div className="flex items-center gap-1 overflow-x-auto">
                  <Filter className="w-3 h-3 text-slate-400 mr-1" />
                  <button
                    onClick={() => setSkuPrefixFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all ${
                      skuPrefixFilter === 'all' 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    ທັງໝົດ
                  </button>
                  {skuRules.map(rule => (
                    <button
                      key={rule.id}
                      onClick={() => setSkuPrefixFilter(rule.prefix)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-all ${
                        skuPrefixFilter === rule.prefix 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      ໝວດ [{rule.prefix}] {rule.name.split(' ')[0]}
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
                    <th className="p-3.5 w-44">ກຸ່ມຕາມ SKU (Auto-Group)</th>
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
                      const matchSearch = String(r.name || '').toLowerCase().includes(searchItem.toLowerCase()) || 
                                          String(r.sku || '').toLowerCase().includes(searchItem.toLowerCase());
                      const matchPrefix = skuPrefixFilter === 'all' || r.prefix === skuPrefixFilter;
                      return matchSearch && matchPrefix;
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

                        {/* 🌟 ສະແດງກຸ່ມທີ່ລະບົບອ່ານອອກມາຈາກ SKU ອັດຕະໂນມັດ */}
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                            item.prefix === 'P' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                            item.prefix === 'S' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                            'bg-slate-100 dark:bg-white/10 text-slate-500'
                          }`}>
                            <span className="font-mono font-black">[{item.prefix || '?'}]</span> {item.groupName}
                          </span>
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
      {/* ແທັບທີ 2: ສູນປ້ອນ / ຈັບຄູ່ SKU */}
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
                  🇱🇦 Auto-Group by Prefix
                </span>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-0.5">
                ໃສ່ເລກ SKU ເຊັ່ນ <strong>P001</strong> (ວັດຖຸດິບ), <strong>S001</strong> (Packaging), <strong>O001</strong> (ສິ້ນເປືອງ). ລະບົບຈະຈັດກຸ່ມໃຫ້ທັນທີ!
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
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
                  <th className="p-3.5 w-80">ພິມເລກ SKU (ເຊັ່ນ P001, S001)</th>
                  <th className="p-3.5 text-center">ສະຖານະ & ກຸ່ມ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {distinctSupplierItems
                  .filter(item => {
                    const matchSearch = item.supplier.toLowerCase().includes(mappingSearch.toLowerCase()) || 
                                        item.rawName.toLowerCase().includes(mappingSearch.toLowerCase());
                    const matchFilter = mappingFilter === 'all' ? true : (mappingFilter === 'unmapped' ? !item.currentSku : !!item.currentSku);
                    return matchSearch && matchFilter;
                  })
                  .map(item => {
                    const supplierKey = `${item.supplier}_${item.rawId}`;
                    const currentVal = inputSkus[supplierKey] !== undefined ? inputSkus[supplierKey] : (item.currentSku || '');
                    const isLinked = !!item.currentSku;
                    const autoInfo = classifySku(currentVal || item.currentSku || '');

                    return (
                      <tr key={supplierKey} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                        <td className="p-3.5 font-bold uppercase text-slate-500">
                          {item.supplier}
                        </td>
                        
                        <td className="p-3.5">
                          <p className="font-bold text-slate-800 dark:text-white">{item.rawName}</p>
                          
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
                                [ໃຊ້ເລກນີ້]
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="p-3.5 text-center font-mono">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-[10px] font-bold">
                            {item.totalPurchasedCount} ບິນ
                          </span>
                        </td>

                        <td className="p-3.5">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={currentVal}
                                placeholder="ຕົວຢ່າງ: P001, S001"
                                onChange={(e) => setInputSkus(prev => ({ ...prev, [supplierKey]: e.target.value.toUpperCase() }))}
                                className="h-8 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none focus:border-indigo-500 w-full uppercase"
                              />
                              <button
                                type="button"
                                disabled={mappingUpdatingId === supplierKey}
                                onClick={() => handleSaveSkuMapping(supplierKey, item.rawId, item.supplier, item.rawName)}
                                className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                                title="ບັນທຶກ"
                              >
                                <Save className="w-3 h-3" />
                                <span>{mappingUpdatingId === supplierKey ? '...' : 'ບັນທຶກ'}</span>
                              </button>
                            </div>

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
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[9.5px] font-mono inline-flex items-center gap-1">
                                <Check className="w-3 h-3" /> {item.currentSku}
                              </span>
                              <span className="text-[8.5px] text-slate-400 font-bold uppercase">
                                {autoInfo.groupName}
                              </span>
                            </div>
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
      {/* 🌟 MODAL ກຳນົດກົດເກນ SKU (SKU PREFIX RULE MANAGER) */}
      {/* ======================================================== */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ກຳນົດກົດເກນ Prefix ຂອງ SKU (SKU Architecture)
                </h3>
              </div>
              <button 
                onClick={() => setShowRuleModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-300">
              ລະບົບຈະອ່ານຕົວອັກສອນທຳອິດຂອງ SKU ແລ້ວຈັດກຸ່ມ + ນັບເຂົ້າ COGS ໃຫ້ອັດຕະໂນມັດ ໂດຍບໍ່ຕ້ອງມານັ່ງເລືອກກຸ່ມເອງ:
            </p>

            {/* ຟອມເພີ່ມ Prefix ໃໝ່ */}
            <div className="p-3.5 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-2.5 border border-slate-200 dark:border-white/10">
              <span className="text-[10px] font-black uppercase text-slate-400">ເພີ່ມກົດເກນ SKU ໃໝ່</span>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="Prefix (ເຊັ່ນ P, S, O)"
                  value={newPrefix}
                  onChange={e => setNewPrefix(e.target.value.toUpperCase())}
                  className="col-span-3 h-9 px-2.5 rounded-xl bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 text-xs font-mono font-bold uppercase outline-none"
                />
                <input
                  type="text"
                  placeholder="ຊື່ກຸ່ມ (ເຊັ່ນ: ວັດຖຸດິບ, Packaging...)"
                  value={newRuleName}
                  onChange={e => setNewRuleName(e.target.value)}
                  className="col-span-5 h-9 px-3 rounded-xl bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none"
                />
                <div className="col-span-4 flex items-center justify-between gap-1">
                  <label className="flex items-center gap-1 text-[11px] font-bold cursor-pointer text-slate-700 dark:text-white">
                    <input
                      type="checkbox"
                      checked={newRuleIsCogs}
                      onChange={e => setNewRuleIsCogs(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span>COGS</span>
                  </label>
                  <button
                    onClick={handleAddSkuRule}
                    className="px-3 h-9 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase rounded-xl cursor-pointer"
                  >
                    + ເພີ່ມ
                  </button>
                </div>
              </div>
            </div>

            {/* ລາຍການກົດເກນ SKU ທີ່ມີໃນປັດຈຸບັນ */}
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {skuRules.map(rule => (
                <div 
                  key={rule.id}
                  className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-white/5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-10 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-black text-xs flex items-center justify-center">
                      [{rule.prefix}]
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{rule.name}</p>
                      <span className={`text-[9.5px] font-black uppercase ${rule.isCogs ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {rule.isCogs ? '✓ ນັບເຂົ້າ COGS (Active in COGS)' : '✗ ບໍ່ນັບເຂົ້າ COGS (Non-COGS)'}
                      </span>
                    </div>
                  </div>
                  {skuRules.length > 1 && (
                    <button
                      onClick={() => handleDeleteSkuRule(rule.id)}
                      className="p-1.5 text-red-400 hover:text-red-500 rounded-lg cursor-pointer"
                      title="ລຶບກົດເກນນີ້"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/10">
              <button
                onClick={() => setShowRuleModal(false)}
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
