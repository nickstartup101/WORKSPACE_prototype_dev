import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db } from '../firebase';
import { 
  collection, addDoc, onSnapshot, 
  deleteDoc, doc, setDoc, serverTimestamp 
} from 'firebase/firestore';
import { 
  Plus, Trash2, Search, Download, 
  List, Receipt, Image as ImageIcon, Upload, Eye, X, Truck,
  Sparkles, Bot, Check, Key
} from 'lucide-react';
import { format } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

const SUPPLIER_CODES: Record<string, string> = {
  'CHANHOM': 'CH',
  'LATDA': 'LD',
  'HEAVENLY': 'HV',
  'DMART': 'DM',
  'MARRY ANN': 'MA',
  'LUCKKHANA': 'LK',
  'LA TERRASSE': 'LT',
  'VIS': 'VS',
  'OTHER': 'OT'
};

export type PaymentMethod = 'Cash' | 'Onepay' | 'LDB';
export type ExpenseCategory = 'purchasing' | 'rental' | 'salary' | 'operation' | 'admin' | 'sales' | 'other';

interface FormItemRow {
  id: string;
  productId: string;
  productSearch: string;
  unit: string;
  priceMode: 'total' | 'per_pack';
  priceOriginal: number;
  displayPrice: string;
  quantity: number;
  quantityPerUnit: number;
  remark: string;
  isDropdownOpen?: boolean;
}

interface ScannedItemPreview {
  rawName: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
  unit: string;
  matchedProductId: string;
  matchedProductName: string;
}

const toStandardDateString = (raw: any): string => {
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

export default function Suppliers() {
  const { i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [entryMode, setEntryMode] = useState<'batch' | 'single'>('batch');
  const [isDragging, setIsDragging] = useState(false);

  // Modals
  const [showProductManager, setShowProductManager] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // 🌟 AI Scanner States & API Key Management
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKeyInput, setTempApiKeyInput] = useState('');

  const [isAiScanning, setIsAiScanning] = useState(false);
  const [showScanReviewModal, setShowScanReviewModal] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItemPreview[]>([]);
  const [scannedSupplier, setScannedSupplier] = useState<string>('');
  const [scannedDate, setScannedDate] = useState<string>('');
  const [scannedTime, setScannedTime] = useState<string>('');
  const [scannedCurrency, setScannedCurrency] = useState<string>('THB');
  const [receiptLearnings, setReceiptLearnings] = useState<Record<string, any>>({});

  // Form State
  const [billDate, setBillDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [billTime, setBillTime] = useState<string>(format(new Date(), 'HH:mm'));
  const [supplier, setSupplier] = useState<string>('CHANHOM');
  const [category, setCategory] = useState<ExpenseCategory>('purchasing');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [currency, setCurrency] = useState<string>('LAK');
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [billImageBase64, setBillImageBase64] = useState<string>('');
  const [billRemark, setBillRemark] = useState<string>('');
  const [saveLoading, setSaveLoading] = useState(false);

  const [billItems, setBillItems] = useState<FormItemRow[]>([
    {
      id: 'item-1',
      productId: '',
      productSearch: '',
      unit: 'UNIT',
      priceMode: 'total',
      priceOriginal: 0,
      displayPrice: '',
      quantity: 1,
      quantityPerUnit: 1,
      remark: '',
      isDropdownOpen: false
    }
  ]);

  const generatedBillNo = useMemo(() => {
    try {
      const parts = billDate.split('-');
      if (parts.length === 3) {
        const ddmmyyyy = `${parts[2]}${parts[1]}${parts[0]}`;
        const code = SUPPLIER_CODES[supplier] || (supplier ? supplier.slice(0, 2).toUpperCase() : 'OT');
        return `#${ddmmyyyy}${code}`;
      }
    } catch {}
    return `#${format(new Date(), 'ddMMyyyy')}${SUPPLIER_CODES[supplier] || 'OT'}`;
  }, [billDate, supplier]);

  // Real-time Firestore Sync
  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubS = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubL = onSnapshot(collection(db, 'receipt_learnings'), (snap) => {
      const map: Record<string, any> = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      setReceiptLearnings(map);
    });

    return () => {
      unsubP();
      unsubS();
      unsubL();
    };
  }, []);

  const sortedSupplierPrices = useMemo(() => {
    return [...supplierPrices].sort((a, b) => {
      const dateA = toStandardDateString(a.date || a.createdAt);
      const dateB = toStandardDateString(b.date || b.createdAt);
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
  }, [supplierPrices]);

  const processImageFile = (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      alert(i18n.language === 'la' ? 'ກະລຸນາເລືອກໄຟລ໌ຮູບພາບ (JPG, PNG)' : 'Please select an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
        canvas.height = img.width > MAX_WIDTH ? (img.height * scaleSize) : img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        setBillImageBase64(compressedBase64);
      };
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            processImageFile(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // ========================================================
  // 🌟 AI OCR SCANNER (ອັບເກຣດ GEMINI 2.0 / 2.5 ພ້ອມ SMART FALLBACK)
  // ========================================================
  const handleScanReceiptWithAi = async () => {
    if (!billImageBase64) {
      alert('ກະລຸນາອັບໂຫຼດຮູບໃບບິນກ່ອນ!');
      return;
    }

    if (!geminiApiKey) {
      setShowApiKeyModal(true);
      return;
    }

    try {
      setIsAiScanning(true);

      const base64Data = billImageBase64.split(',')[1];
      const mimeType = billImageBase64.split(';')[0].split(':')[1] || 'image/jpeg';

      const promptText = `
You are an expert digital receipt scanner for a cafe & restaurant in Laos and Thailand.
Examine this actual receipt image very carefully.
Extract the REAL details printed on this receipt:
1. "supplier": Match to one of [LUCKKHANA, CHANHOM, LATDA, HEAVENLY, DMART, MARRY ANN, LA TERRASSE, VIS, OTHER] based on store name or logo.
2. "date": In YYYY-MM-DD. (Important: If date year is in Thai/Lao Buddhist Era like 2569, convert to CE 2026 by subtracting 543).
3. "time": Time in HH:MM format if available.
4. "currency": "THB" or "LAK".
5. "items": Array of items bought:
   - "name": Exact product description as printed on this receipt
   - "quantity": Number of units bought
   - "pricePerUnit": Price per unit
   - "totalPrice": Total line price for this item
   - "unit": e.g. ชิ้น, ลัง, แพ็ค, ถุง, or unit

Return ONLY raw valid JSON with no markdown wrapping and no backticks.
Format:
{"supplier":"","date":"","time":"","currency":"","items":[{"name":"","quantity":1,"pricePerUnit":0,"totalPrice":0,"unit":""}]}
`;

      // 🌟 ລາຍຊື່ Model ໃໝ່ລ່າສຸດ (Gemini 2.0 / 2.5 / 1.5) ເພື່ອລອງເອີ້ນແບບອັດຕະໂນມັດ
      const CANDIDATE_MODELS = [
        'gemini-2.0-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash-exp',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash'
      ];

      let aiResultJson: any = null;
      let lastErrorMessage = '';

      for (const model of CANDIDATE_MODELS) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: promptText },
                    { inlineData: { mimeType: mimeType, data: base64Data } }
                  ]
                }
              ]
            })
          });

          const resData = await response.json();
          if (resData.error) {
            lastErrorMessage = resData.error.message;
            continue; // ລອງ Model ຖັດໄປທັນທີ
          }

          const rawReply = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiResultJson = JSON.parse(jsonMatch[0]);
            break; // ສຳເລັດແລ້ວ!
          }
        } catch (e: any) {
          lastErrorMessage = e.message;
        }
      }

      if (!aiResultJson) {
        throw new Error(lastErrorMessage || 'ບໍ່ພົບ Model ທີ່ຮອງຮັບໃນ API Key ນີ້');
      }

      if (aiResultJson.supplier) {
        const matchedSup = Object.keys(SUPPLIER_CODES).find(k => k.toLowerCase() === String(aiResultJson.supplier).toLowerCase()) || 'OTHER';
        setScannedSupplier(matchedSup);
      }
      if (aiResultJson.date) setScannedDate(aiResultJson.date);
      if (aiResultJson.time) setScannedTime(aiResultJson.time);
      if (aiResultJson.currency) setScannedCurrency(aiResultJson.currency);

      const matchedItems: ScannedItemPreview[] = (aiResultJson.items || []).map((it: any) => {
        const cleanNameKey = String(it.name || '').trim().toLowerCase().replace(/\s+/g, '_');
        
        let targetProdId = '';
        let targetProdName = '';

        if (receiptLearnings[cleanNameKey]?.productId) {
          targetProdId = receiptLearnings[cleanNameKey].productId;
          const found = products.find(p => p.id === targetProdId);
          targetProdName = found?.name || receiptLearnings[cleanNameKey].productName;
        } else {
          const directMatch = products.find(p => 
            p.name.toLowerCase().includes(String(it.name || '').toLowerCase()) || 
            String(it.name || '').toLowerCase().includes(p.name.toLowerCase())
          );
          if (directMatch) {
            targetProdId = directMatch.id;
            targetProdName = directMatch.name;
          }
        }

        return {
          rawName: it.name || 'Unknown item',
          quantity: Number(it.quantity) || 1,
          pricePerUnit: Number(it.pricePerUnit) || 0,
          totalPrice: Number(it.totalPrice) || (Number(it.quantity) * Number(it.pricePerUnit)),
          unit: it.unit || 'UNIT',
          matchedProductId: targetProdId,
          matchedProductName: targetProdName
        };
      });

      setScannedItems(matchedItems);
      setShowScanReviewModal(true);

    } catch (err: any) {
      alert('Error parsing receipt with AI: ' + err.message + '\n(ກະລຸນາກວດສອບ Gemini API Key ຂອງທ່ານ)');
      setShowApiKeyModal(true);
    } finally {
      setIsAiScanning(false);
    }
  };

  const handleSaveApiKey = () => {
    const cleanKey = tempApiKeyInput.trim();
    if (!cleanKey) return;
    localStorage.setItem('gemini_api_key', cleanKey);
    setGeminiApiKey(cleanKey);
    setShowApiKeyModal(false);
    alert('✅ ບັນທຶກ API Key ສຳເລັດ! ລະບົບພ້ອມອ່ານໃບບິນຕົວຈິງແລ້ວ.');
  };

  const handleConfirmAndImportScannedItems = async () => {
    for (const it of scannedItems) {
      if (it.matchedProductId) {
        const cleanKey = it.rawName.trim().toLowerCase().replace(/\s+/g, '_');
        await setDoc(doc(db, 'receipt_learnings', cleanKey), {
          rawName: it.rawName,
          productId: it.matchedProductId,
          productName: it.matchedProductName,
          supplier: scannedSupplier,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }

    if (scannedSupplier) setSupplier(scannedSupplier);
    if (scannedDate) setBillDate(scannedDate);
    if (scannedTime) setBillTime(scannedTime);
    if (scannedCurrency) {
      setCurrency(scannedCurrency);
      if (scannedCurrency === 'THB') setExchangeRate(650);
      else setExchangeRate(1);
    }

    const convertedRows: FormItemRow[] = scannedItems.map((it, idx) => ({
      id: `ai-item-${Date.now()}-${idx}`,
      productId: it.matchedProductId || '',
      productSearch: it.matchedProductName || it.rawName,
      unit: it.unit || 'UNIT',
      priceMode: 'total',
      priceOriginal: it.totalPrice,
      displayPrice: it.totalPrice.toLocaleString(),
      quantity: it.quantity,
      quantityPerUnit: 1,
      remark: it.rawName,
      isDropdownOpen: false
    }));

    setBillItems(convertedRows);
    setShowScanReviewModal(false);
    alert(`🎉 ນຳເຂົ້າສຳເລັດ ${scannedItems.length} ລາຍການ! ລະບົບໄດ້ບັນທຶກການຈື່ຈຳສິນຄ້າຮຽບຮ້ອຍ.`);
  };

  const handleRemoveScannedItem = (index: number) => {
    setScannedItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMatchedProduct = (index: number, prodId: string) => {
    const prod = products.find(p => p.id === prodId);
    setScannedItems(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        matchedProductId: prodId,
        matchedProductName: prod?.name || ''
      };
      return updated;
    });
  };

  const updateItemRow = (index: number, fields: Partial<FormItemRow>) => {
    setBillItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...fields };
      return updated;
    });
  };

  const addNewItemRow = () => {
    setBillItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        productId: '',
        productSearch: '',
        unit: 'UNIT',
        priceMode: 'total',
        priceOriginal: 0,
        displayPrice: '',
        quantity: 1,
        quantityPerUnit: 1,
        remark: '',
        isDropdownOpen: false
      }
    ]);
  };

  const removeItemRow = (index: number) => {
    if (billItems.length === 1) return;
    setBillItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemPriceChange = (index: number, rawVal: string) => {
    const cleanNum = rawVal.replace(/,/g, '');
    if (cleanNum === '' || !isNaN(Number(cleanNum))) {
      updateItemRow(index, {
        displayPrice: Number(cleanNum || 0).toLocaleString(),
        priceOriginal: Number(cleanNum) || 0
      });
    }
  };

  const grandTotalLAK = useMemo(() => {
    const rate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);
    return billItems.reduce((acc, item) => {
      const orig = Number(item.priceOriginal) || 0;
      const qty = Number(item.quantity) || 1;
      const totalOrig = item.priceMode === 'total' ? orig : orig * qty;
      return acc + (totalOrig * rate);
    }, 0);
  }, [billItems, currency, exchangeRate]);

  const handleSaveBillBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier) {
      alert('ກະລຸນາເລືອກຜູ້ສະໜອງ (Supplier)');
      return;
    }

    for (let i = 0; i < billItems.length; i++) {
      if (!billItems[i].productId) {
        alert(`ລາຍການທີ ${i + 1} ຍັງບໍ່ໄດ້ເລືອກສິນຄ້າ. ກະລຸນາເລືອກຈາກລາຍຊື່.`);
        return;
      }
    }

    try {
      setSaveLoading(true);
      const batchGroupId = `bill_${Date.now()}`;
      const finalRate = currency === 'LAK' ? 1 : (Number(exchangeRate) || 1);

      for (const item of billItems) {
        const qty = Number(item.quantity) || 1;
        const qtyPerUnit = Number(item.quantityPerUnit) || 1;
        let singlePriceOriginal = Number(item.priceOriginal) || 0;

        if (item.priceMode === 'total') {
          singlePriceOriginal = Number(item.priceOriginal) / qty;
        }

        const calculatedPriceLAK = singlePriceOriginal * finalRate;
        const totalOriginal = item.priceMode === 'total' ? Number(item.priceOriginal) : singlePriceOriginal * qty;
        const totalLAK = totalOriginal * finalRate;

        await addDoc(collection(db, 'supplierPrices'), {
          billNo: generatedBillNo,
          batchGroupId,
          billImageUrl: billImageBase64 || '',
          billRemark: billRemark.trim(),
          productId: item.productId,
          supplier,
          category,
          paymentMethod,
          currency,
          exchangeRate: finalRate,
          priceOriginal: singlePriceOriginal,
          priceLAK: calculatedPriceLAK,
          totalPriceOriginal: totalOriginal,
          totalPriceLAK: totalLAK,
          quantity: qty,
          quantityPerUnit: qtyPerUnit,
          unit: item.unit || 'UNIT',
          remark: item.remark || '',
          date: billDate,
          time: billTime,
          priceMode: item.priceMode,
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
        });
      }

      alert(`ບັນທຶກເລກບິນ ${generatedBillNo} ສຳເລັດ!`);
      setBillImageBase64('');
      setBillRemark('');
      setBillItems([{
        id: `item-${Date.now()}`,
        productId: '',
        productSearch: '',
        unit: 'UNIT',
        priceMode: 'total',
        priceOriginal: 0,
        displayPrice: '',
        quantity: 1,
        quantityPerUnit: 1,
        remark: '',
        isDropdownOpen: false
      }]);
    } catch (err: any) {
      alert(`Error saving to Firestore: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (window.confirm('ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບລາຍການນີ້?')) {
      try {
        await deleteDoc(doc(db, 'supplierPrices', id));
      } catch (err: any) {
        alert('Error: ' + err.message);
      }
    }
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Truck className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {i18n.language === 'la' ? 'ລະບົບຈັດຊື້ & ຜູ້ສະໜອງ (Supplier Procurement)' : 'Supplier Procurement Desk'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {products.length} ສິນຄ້າໃນຄັງ • {supplierPrices.length} ໃບບິນຈັດຊື້ທັງໝົດ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTempApiKeyInput(geminiApiKey);
              setShowApiKeyModal(true);
            }}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white rounded-xl text-xs font-bold uppercase flex items-center gap-1.5 cursor-pointer"
            title="ຕັ້ງຄ່າ Gemini API Key ເພື່ອໃຫ້ AI ອ່ານບິນ"
          >
            <Key className="w-3.5 h-3.5 text-amber-500" />
            <span>{geminiApiKey ? 'API Key (Active)' : 'ໃສ່ API Key'}</span>
          </button>

          <button 
            onClick={() => setShowProductManager(true)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white rounded-xl text-xs font-bold uppercase cursor-pointer"
          >
            <List className="w-3.5 h-3.5 inline mr-1" /> Items ({products.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* LEFT: Bill Entry Form */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-white dark:bg-[#073069] p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl space-y-5">
            
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-white/10 pb-4">
              <div>
                <span className="px-2.5 py-1 bg-primary/10 text-primary rounded-full text-[9px] font-black uppercase">
                  {entryMode === 'batch' ? 'MULTI-ITEM BILL' : 'SINGLE ENTRY'}
                </span>
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase mt-1 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-500" />
                  <span>ບັນທຶກໃບບິນຈັດຊື້</span>
                </h3>
              </div>

              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setEntryMode('batch')}
                  className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg cursor-pointer ${entryMode === 'batch' ? 'bg-[#052659] text-white' : 'text-slate-500'}`}
                >
                  ຫຼາຍລາຍການ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntryMode('single');
                    if (billItems.length > 1) setBillItems([billItems[0]]);
                  }}
                  className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg cursor-pointer ${entryMode === 'single' ? 'bg-[#052659] text-white' : 'text-slate-500'}`}
                >
                  ລາຍການດ່ຽວ
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveBillBatch} className="space-y-4">
              
              {/* 🌟 1. ບ່ອນອັບໂຫຼດຮູບ + ປຸ່ມ AI SCANNER ພ້ອມ LASER SCANNING ANIMATION */}
              <div 
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.[0]) processImageFile(e.dataTransfer.files[0]); }}
                className={`p-3.5 rounded-2xl border-2 border-dashed transition-all relative overflow-hidden ${
                  isDragging ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-[#052659]/50'
                }`}
              >
                {isAiScanning && (
                  <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
                    <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-bounce" />
                    <div className="absolute inset-0 bg-cyan-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
                      <Bot className="w-8 h-8 text-cyan-400 animate-pulse" />
                      <span className="text-xs font-black uppercase text-cyan-300 tracking-wider">
                        AI ກຳລັງອ່ານລາຍການໃບບິນຕົວຈິງ...
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9.5px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                    <span>Receipt Image (Drop or Ctrl+V)</span>
                  </span>
                  {billImageBase64 && (
                    <button type="button" onClick={() => setBillImageBase64('')} className="text-[9px] font-black text-red-500 uppercase cursor-pointer">Remove</button>
                  )}
                </div>

                {billImageBase64 ? (
                  <div className="space-y-2">
                    <div className="relative rounded-xl overflow-hidden max-h-36 bg-black/10 flex items-center justify-center">
                      <img src={billImageBase64} alt="Receipt" className="w-full h-36 object-contain cursor-pointer" onClick={() => setPreviewImageUrl(billImageBase64)} />
                    </div>

                    <button
                      type="button"
                      disabled={isAiScanning}
                      onClick={handleScanReceiptWithAi}
                      className="w-full h-10 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-black uppercase flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-all disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300 animate-spin" />
                      <span>{isAiScanning ? 'AI ກຳລັງສະແກນ...' : '⚡ ສະແກນໃບບິນຕົວຈິງດ້ວຍ AI (Lao/Thai/Eng)'}</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      accept="image/*" 
                      onChange={e => e.target.files?.[0] && processImageFile(e.target.files[0])} 
                      className="hidden" 
                      id="supplier-upload" 
                    />
                    <label htmlFor="supplier-upload" className="w-full py-4 rounded-xl border border-slate-200 dark:border-white/10 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                      <Upload className="w-5 h-5 text-emerald-500" />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">ອັບໂຫຼດຮູບໃບບິນ / ວາງ (Ctrl+V)</span>
                      <span className="text-[9px] text-slate-400">ຮອງຮັບບິນດິຈິຕອນ ພາສາລາວ, ໄທ, ອັງກິດ</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Date, Time, Bill No */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Date</label>
                  <input 
                    type="date"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                    value={billDate}
                    onChange={e => setBillDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Time</label>
                  <input 
                    type="time"
                    required
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                    value={billTime}
                    onChange={e => setBillTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Bill No.</label>
                  <div className="w-full h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-mono font-black text-xs flex items-center justify-center">
                    {generatedBillNo}
                  </div>
                </div>
              </div>

              {/* Supplier, Category, Payment */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Supplier</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold cursor-pointer"
                    value={supplier}
                    onChange={e => setSupplier(e.target.value)}
                  >
                    <option value="CHANHOM">CHANHOM (CH)</option>
                    <option value="LATDA">LATDA (LD)</option>
                    <option value="HEAVENLY">HEAVENLY (HV)</option>
                    <option value="DMART">DMART (DM)</option>
                    <option value="MARRY ANN">MARRY ANN (MA)</option>
                    <option value="LUCKKHANA">Luckkhana (LK)</option>
                    <option value="LA TERRASSE">La Terrasse (LT)</option>
                    <option value="VIS">VIS (VS)</option>
                    <option value="OTHER">Other (OT)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Category</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold cursor-pointer"
                    value={category}
                    onChange={e => setCategory(e.target.value as any)}
                  >
                    <option value="purchasing">Purchasing</option>
                    <option value="rental">Rental</option>
                    <option value="salary">Salary</option>
                    <option value="operation">Operation</option>
                    <option value="admin">Admin</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Payment</label>
                  <select 
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold cursor-pointer"
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as any)}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Onepay">OnePay</option>
                    <option value="LDB">LDB</option>
                  </select>
                </div>
              </div>

              {/* Currency & Exchange Rate */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ສະກຸນເງິນ (Currency)</label>
                  <select
                    value={currency}
                    onChange={e => {
                      setCurrency(e.target.value);
                      if (e.target.value === 'LAK') setExchangeRate(1);
                      else if (e.target.value === 'THB') setExchangeRate(650);
                    }}
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold cursor-pointer"
                  >
                    <option value="LAK">LAK (ກີບ)</option>
                    <option value="THB">THB (ບາດ)</option>
                  </select>
                </div>
                {currency !== 'LAK' && (
                  <div>
                    <label className="text-[9.5px] font-black uppercase text-slate-400">ອັດຕາແລກປ່ຽນ (Rate)</label>
                    <input
                      type="number"
                      step="any"
                      value={exchangeRate}
                      onChange={e => setExchangeRate(parseFloat(e.target.value) || 1)}
                      className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Items in Bill */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black uppercase text-slate-400">Items in this Bill</label>
                  {entryMode === 'batch' && (
                    <button
                      type="button"
                      onClick={addNewItemRow}
                      className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-black uppercase flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> ເພີ່ມລາຍການ
                    </button>
                  )}
                </div>

                {billItems.map((item, index) => {
                  const selectedProd = products.find(p => p.id === item.productId);

                  return (
                    <div key={item.id} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#052659]/60 border border-slate-200 dark:border-white/10 space-y-2.5 relative">
                      {billItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItemRow(index)}
                          className="absolute top-2 right-2 text-red-400 hover:text-red-500 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <div className="space-y-1 relative pr-6">
                        <label className="text-[9px] font-black uppercase text-slate-400">Product #{index + 1}</label>
                        <input 
                          type="text"
                          required
                          className={`w-full h-10 px-3 pr-8 rounded-xl bg-white dark:bg-[#073069] border text-xs font-bold outline-none cursor-pointer ${
                            !item.productId && item.productSearch ? 'border-amber-400' : 'border-slate-200 dark:border-white/10 text-slate-800 dark:text-white'
                          }`}
                          placeholder="ຄົ້ນຫາຊື່ສິນຄ້າ..."
                          value={item.isDropdownOpen ? item.productSearch : (selectedProd?.name || item.productSearch)}
                          onFocus={() => updateItemRow(index, { isDropdownOpen: true })}
                          onClick={() => updateItemRow(index, { isDropdownOpen: true })}
                          onChange={(e) => updateItemRow(index, { productSearch: e.target.value, isDropdownOpen: true, productId: '' })}
                        />
                        <Search className="absolute right-9 top-7 w-3.5 h-3.5 text-slate-400 pointer-events-none" />

                        {item.isDropdownOpen && (
                          <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-56 overflow-y-auto">
                            {products
                              .filter(p => !item.productSearch || p.name.toLowerCase().includes(item.productSearch.toLowerCase()))
                              .map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className="w-full text-left p-2.5 hover:bg-slate-100 dark:hover:bg-white/10 border-b border-slate-50 dark:border-white/5 flex justify-between items-center cursor-pointer"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateItemRow(index, {
                                      productId: p.id,
                                      productSearch: p.name,
                                      unit: p.unit || item.unit,
                                      isDropdownOpen: false
                                    });
                                  }}
                                >
                                  <span className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</span>
                                  <span className="text-[9px] text-slate-400 font-bold uppercase">{p.unit || 'UNIT'}</span>
                                </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-6">
                          <label className="text-[8.5px] font-black uppercase text-slate-400">Total Price ({currency})</label>
                          <input 
                            type="text"
                            required
                            placeholder="ລາຄາ"
                            className="w-full h-9 px-2.5 rounded-xl bg-white dark:bg-[#073069] border text-xs font-mono font-bold"
                            value={item.displayPrice}
                            onChange={e => handleItemPriceChange(index, e.target.value)}
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[8.5px] font-black uppercase text-slate-400">Qty</label>
                          <input 
                            type="number"
                            min="1"
                            step="any"
                            required
                            placeholder="ຈຳນວນ"
                            className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border text-xs font-mono font-bold text-center"
                            value={item.quantity || ''}
                            onChange={e => updateItemRow(index, { quantity: parseFloat(e.target.value) || 1 })}
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[8.5px] font-black uppercase text-slate-400">Unit</label>
                          <input 
                            type="text"
                            placeholder="ຫົວໜ່ວຍ"
                            className="w-full h-9 px-2 rounded-xl bg-white dark:bg-[#073069] border text-xs font-bold text-center uppercase"
                            value={item.unit}
                            onChange={e => updateItemRow(index, { unit: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">Remark (ໝາຍເຫດ)</label>
                <input 
                  type="text"
                  placeholder="ໝາຍເຫດເພີ່ມເຕີມ..."
                  className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs"
                  value={billRemark}
                  onChange={e => setBillRemark(e.target.value)}
                />
              </div>

              {/* Total & Submit */}
              <div className="p-3.5 bg-[#052659] text-white rounded-2xl flex justify-between items-center">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#5483B3]">Total Cost (LAK)</p>
                  <p className="text-lg font-black font-mono">{Math.round(grandTotalLAK).toLocaleString()} ₭</p>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={saveLoading}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase rounded-2xl shadow-lg cursor-pointer transition-all disabled:opacity-50"
              >
                {saveLoading ? 'SAVING...' : `ບັນທຶກໃບບິນຈັດຊື້ (${generatedBillNo})`}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT: Table */}
        <div className="xl:col-span-7 space-y-6">
          <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">Active Procurement Ledger</h3>
              <button onClick={() => {
                const headers = ['Bill No', 'Date', 'Product', 'Supplier', 'Price LAK', 'Total LAK', 'Qty', 'Unit'];
                const rows = sortedSupplierPrices.map(p => [
                  p.billNo || '-',
                  toStandardDateString(p.date || p.createdAt),
                  products.find(prod => prod.id === p.productId)?.name || 'Item',
                  p.supplier,
                  p.priceLAK || 0,
                  p.totalPriceLAK || 0,
                  p.quantity,
                  p.unit
                ]);
                const worksheet = utils.aoa_to_sheet([headers, ...rows]);
                const workbook = utils.book_new();
                utils.book_append_sheet(workbook, worksheet, 'Suppliers');
                writeFile(workbook, `Suppliers_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
              }} className="px-3 py-1 bg-slate-100 dark:bg-white/10 rounded-xl text-xs font-bold uppercase text-blue-500 cursor-pointer">
                <Download className="w-3 h-3 inline mr-1" /> Excel
              </button>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-white/5">
                  <tr>
                    <th className="p-3.5">Bill No / Date</th>
                    <th className="p-3.5">Product Name</th>
                    <th className="p-3.5">Supplier</th>
                    <th className="p-3.5">Total (LAK)</th>
                    <th className="p-3.5 text-right">Qty</th>
                    <th className="p-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {sortedSupplierPrices.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                      <td className="p-3.5">
                        <span className="font-mono text-[9px] font-bold text-emerald-500 block">{p.billNo}</span>
                        <span className="text-[10px] text-slate-400">{toStandardDateString(p.date || p.createdAt)}</span>
                      </td>
                      <td className="p-3.5 font-bold text-slate-800 dark:text-white">
                        {products.find(prod => prod.id === p.productId)?.name || 'Item'}
                      </td>
                      <td className="p-3.5 text-slate-400 uppercase">{p.supplier}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900 dark:text-white">
                        {Math.round(Number(p.totalPriceLAK || 0)).toLocaleString()} ₭
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold">{p.quantity} {p.unit}</td>
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {p.billImageUrl && (
                            <button
                              onClick={() => setPreviewImageUrl(p.billImageUrl)}
                              className="p-1.5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-blue-500 cursor-pointer"
                              title="View Receipt"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteEntry(p.id)}
                            className="p-1.5 hover:bg-red-500/10 rounded-lg text-red-500 cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {/* Modal ຕັ້ງຄ່າ API Key */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ຕັ້ງຄ່າ Google Gemini API Key
                </h3>
              </div>
              <button onClick={() => setShowApiKeyModal(false)} className="cursor-pointer text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-300">
              ເພື່ອໃຫ້ AI ອ່ານໃບບິນຕົວຈິງໄດ້ທຸກຮ້ານ ທຸກພາສາ (ຟຣີ 100%):
            </p>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-bold">👉 ວິທີເອົາ API Key ຟຣີ (20 ວິນາທີ):</p>
              <p>1. ເຂົ້າເວັບ: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline font-bold text-indigo-500">aistudio.google.com/app/apikey</a></p>
              <p>2. Login Gmail ແລ້ວກົດປຸ່ມ <strong>Create API Key</strong></p>
              <p>3. Copy ລະຫັດມາໃສ່ໃນຊ່ອງລຸ່ມນີ້:</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-400">ວາງ Gemini API Key ທີ່ນີ້:</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={tempApiKeyInput}
                onChange={e => setTempApiKeyInput(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none focus:border-indigo-500"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-white/10">
              <button
                type="button"
                onClick={() => setShowApiKeyModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase shadow-md cursor-pointer"
              >
                ບັນທຶກ API Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ສະແກນໃບບິນ & ຈັບຄູ່ */}
      {showScanReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                  ຜົນການສະແກນໃບບິນຕົວຈິງ & ຈັບຄູ່ສິນຄ້າ (AI Scan & Learn)
                </h3>
              </div>
              <button onClick={() => setShowScanReviewModal(false)} className="cursor-pointer text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-indigo-50/50 dark:bg-white/5 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">ຮ້ານທີ່ກວດພົບ:</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase">{scannedSupplier}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">ວັນທີ & ເວລາ:</span>
                <span className="font-mono font-bold">{scannedDate} {scannedTime}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">ສະກຸນເງິນ:</span>
                <span className="font-bold font-mono">{scannedCurrency}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">ລວມຍອດບິນ:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  {scannedItems.reduce((acc, it) => acc + it.totalPrice, 0).toLocaleString()} {scannedCurrency}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-300">
              ກວດສອບການຈັບຄູ່ສິນຄ້າ. <strong>ເມື່ອທ່ານເລືອກຈັບຄູ່ແລ້ວ ລະບົບຈະ Learn ແລະ ຈື່ຈຳໄວ້ສຳລັບໃບບິນຮອບຕໍ່ໆໄປ:</strong>
            </p>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {scannedItems.map((item, idx) => (
                <div 
                  key={idx}
                  className="p-3.5 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 space-y-2 relative"
                >
                  <button
                    type="button"
                    onClick={() => handleRemoveScannedItem(idx)}
                    className="absolute top-2.5 right-2.5 text-red-400 hover:text-red-500 p-1 cursor-pointer"
                    title="ລຶບລາຍການນີ້ອອກ (ບໍ່ນຳເຂົ້າ)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="pr-8">
                    <span className="text-[9.5px] font-bold text-slate-400 uppercase block">ຊື່ໃນໃບບິນ (Original):</span>
                    <p className="text-xs font-bold text-slate-800 dark:text-white">{item.rawName}</p>
                  </div>

                  <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t border-slate-100 dark:border-white/5">
                    <div className="col-span-4 text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                      {item.quantity} {item.unit} @ {item.pricePerUnit.toLocaleString()} = <span className="text-indigo-600 dark:text-indigo-400 font-black">{item.totalPrice.toLocaleString()} {scannedCurrency}</span>
                    </div>

                    <div className="col-span-8">
                      <select
                        value={item.matchedProductId}
                        onChange={e => handleUpdateMatchedProduct(idx, e.target.value)}
                        className={`w-full h-9 px-2 text-xs font-bold rounded-xl border outline-none cursor-pointer ${
                          item.matchedProductId 
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' 
                            : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-500/30 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        <option value="">-- ເລືອກສິນຄ້າໃນຄັງ (Link to Product) --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            [{p.sku || 'No-SKU'}] {p.name} ({p.unit})
                          </option>
                        ))}
                      </select>
                      {item.matchedProductId && (
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold mt-0.5 flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" /> ລະບົບຈະຈື່ວ່າຊື່ນີ້ຄືສິນຄ້ານີ້
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/10 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500">
                ລວມ {scannedItems.length} ລາຍການ
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowScanReviewModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="button"
                  disabled={scannedItems.length === 0}
                  onClick={handleConfirmAndImportScannedItems}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>ນຳເຂົ້າບິນ & ບັນທຶກການຈື່ຈຳ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Manager Modal */}
      {showProductManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-xs font-black uppercase">Database Products</h3>
              <button onClick={() => setShowProductManager(false)} className="cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {products.map(p => (
                <div key={p.id} className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl flex justify-between items-center text-xs">
                  <span className="font-bold">{p.name}</span>
                  <span className="text-slate-400 uppercase font-mono">{p.unit || 'UNIT'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-white dark:bg-[#073069] p-4 rounded-3xl max-w-2xl max-h-[90vh] flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-black uppercase">Receipt Preview</span>
              <button onClick={() => setPreviewImageUrl(null)} className="cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <img src={previewImageUrl} alt="Receipt Preview" className="max-h-[75vh] object-contain rounded-xl" />
          </div>
        </div>
      )}

    </div>
  );
}
