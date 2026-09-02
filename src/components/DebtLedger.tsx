import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { 
  CreditCard, PlusCircle, CheckCircle2, Clock, Trash2, 
  Search, Download, DollarSign, ArrowUpRight, ArrowDownRight,
  Filter, Calendar, User, Phone, X, Edit3
} from 'lucide-react';
import { format } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

export default function DebtLedger({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'payable' | 'receivable'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid'>('all');

  // Form Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'payable' as 'payable' | 'receivable', // payable = ໜີ້ຕ້ອງສົ່ງ (AP), receivable = ໜີ້ຕ້ອງຮັບ (AR)
    partyName: '',
    phone: '',
    amount: 0,
    dueDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'pending' as 'pending' | 'paid',
    note: ''
  });

  useEffect(() => {
    const branch = selectedBranch || 'branch_1';
    const unsub = onSnapshot(collection(db, 'debts'), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDebts(all.filter((d: any) => (d.branchId || 'branch_1') === branch));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'debts');
      setLoading(false);
    });
    return () => unsub();
  }, [selectedBranch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.partyName.trim() || formData.amount <= 0) return;

    try {
      if (editingId) {
        await updateDoc(doc(db, 'debts', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'debts'), {
          ...formData,
          branchId: selectedBranch || 'branch_1',
          createdAt: serverTimestamp()
        });
      }

      setShowModal(false);
      setEditingId(null);
      setFormData({
        type: 'payable',
        partyName: '',
        phone: '',
        amount: 0,
        dueDate: format(new Date(), 'yyyy-MM-dd'),
        status: 'pending',
        note: ''
      });
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleToggleStatus = async (debt: any) => {
    const newStatus = debt.status === 'paid' ? 'pending' : 'paid';
    await updateDoc(doc(db, 'debts', debt.id), {
      status: newStatus,
      paidAt: newStatus === 'paid' ? serverTimestamp() : null
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    await deleteDoc(doc(db, 'debts', id));
  };

  // Filtered List & Summary
  const filteredDebts = useMemo(() => {
    return debts.filter(d => {
      const matchesSearch = String(d.partyName || '').toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === 'all' || d.type === filterType;
      const matchesStatus = filterStatus === 'all' || d.status === filterStatus;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [debts, search, filterType, filterStatus]);

  const summary = useMemo(() => {
    let totalPayable = 0; // AP
    let totalReceivable = 0; // AR
    let pendingPayable = 0;
    let pendingReceivable = 0;

    debts.forEach(d => {
      const amt = Number(d.amount) || 0;
      if (d.type === 'payable') {
        totalPayable += amt;
        if (d.status === 'pending') pendingPayable += amt;
      } else {
        totalReceivable += amt;
        if (d.status === 'pending') pendingReceivable += amt;
      }
    });

    return { totalPayable, totalReceivable, pendingPayable, pendingReceivable };
  }, [debts]);

  const handleExport = () => {
    const headers = ['Type', 'Name / Vendor', 'Phone', 'Amount (LAK)', 'Due Date', 'Status', 'Note'];
    const rows = filteredDebts.map(d => [
      d.type === 'payable' ? 'Accounts Payable (AP)' : 'Accounts Receivable (AR)',
      d.partyName,
      d.phone || '-',
      d.amount,
      d.dueDate,
      d.status,
      d.note || ''
    ]);
    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Debts');
    writeFile(workbook, `Debts_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/80 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <CreditCard className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {i18n.language === 'la' ? 'ຄຸ້ມຄອງໜີ້ສິນ (AP/AR Debt Ledger)' : 'Debt Ledger (AP / AR)'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              Accounts Payable (ໜີ້ຕ້ອງສົ່ງ) & Accounts Receivable (ໜີ້ຕ້ອງຮັບ)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold uppercase cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 inline mr-1" /> Excel
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setFormData({
                type: 'payable',
                partyName: '',
                phone: '',
                amount: 0,
                dueDate: format(new Date(), 'yyyy-MM-dd'),
                status: 'pending',
                note: ''
              });
              setShowModal(true);
            }}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{i18n.language === 'la' ? 'ເພີ່ມລາຍການໜີ້' : 'Add Debt'}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Pending Payable (AP) */}
        <div className="p-5 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <ArrowDownRight className="w-4 h-4" />
            ໜີ້ຕ້ອງສົ່ງທີ່ຄ້າງຊຳລະ (Pending AP)
          </span>
          <p className="text-2xl font-black font-mono">
            {Math.round(summary.pendingPayable).toLocaleString()} ₭
          </p>
          <p className="text-[9px] opacity-75 font-bold uppercase">Total AP: {Math.round(summary.totalPayable).toLocaleString()} ₭</p>
        </div>

        {/* Pending Receivable (AR) */}
        <div className="p-5 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <ArrowUpRight className="w-4 h-4" />
            ໜີ້ຕ້ອງຮັບທີ່ລໍຖ້າເກັບ (Pending AR)
          </span>
          <p className="text-2xl font-black font-mono">
            {Math.round(summary.pendingReceivable).toLocaleString()} ₭
          </p>
          <p className="text-[9px] opacity-75 font-bold uppercase">Total AR: {Math.round(summary.totalReceivable).toLocaleString()} ₭</p>
        </div>

      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#073069] rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 shadow-xl space-y-4">
        
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="relative max-w-xs w-full">
            <input
              type="text"
              placeholder="Search..."
              className="w-full h-9 pl-8 pr-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
          </div>

          <div className="flex gap-2">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as any)}
              className="h-9 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold"
            >
              <option value="all">All Types</option>
              <option value="payable">Accounts Payable (AP - ຕ້ອງສົ່ງ)</option>
              <option value="receivable">Accounts Receivable (AR - ຕ້ອງຮັບ)</option>
            </select>

            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as any)}
              className="h-9 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending (ຄ້າງຊຳລະ)</option>
              <option value="paid">Paid (ຊຳລະແລ້ວ)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100/50 dark:bg-white/5">
              <tr>
                <th className="p-3.5">Type</th>
                <th className="p-3.5">Name / Contact</th>
                <th className="p-3.5">Amount (LAK)</th>
                <th className="p-3.5">Due Date</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredDebts.map(d => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <td className="p-3.5">
                    <span className={`px-2 py-0.5 rounded text-[8.5px] font-black uppercase ${
                      d.type === 'payable' ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600'
                    }`}>
                      {d.type === 'payable' ? 'AP (ຕ້ອງສົ່ງ)' : 'AR (ຕ້ອງຮັບ)'}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <p className="font-bold text-slate-800 dark:text-white">{d.partyName}</p>
                    <p className="text-[9px] text-slate-400">{d.phone || d.note || '-'}</p>
                  </td>
                  <td className="p-3.5 font-mono font-black text-slate-900 dark:text-white">
                    {Number(d.amount || 0).toLocaleString()} ₭
                  </td>
                  <td className="p-3.5 text-slate-400 font-mono">{d.dueDate}</td>
                  <td className="p-3.5">
                    <button
                      onClick={() => handleToggleStatus(d)}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase cursor-pointer transition-all ${
                        d.status === 'paid' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white animate-pulse'
                      }`}
                    >
                      {d.status === 'paid' ? 'Paid ✓' : 'Pending ⏳'}
                    </button>
                  </td>
                  <td className="p-3.5 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setFormData({ ...d });
                          setShowModal(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-blue-500"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredDebts.length === 0 && (
            <p className="text-xs text-slate-400 uppercase font-bold text-center py-10">No debt records found</p>
          )}
        </div>

      </div>

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/10 space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-xs font-black uppercase text-slate-800 dark:text-white">
                {editingId ? 'Edit Debt Record' : 'New Debt Record'}
              </h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'payable' })}
                  className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg ${
                    formData.type === 'payable' ? 'bg-rose-500 text-white' : 'text-slate-400'
                  }`}
                >
                  Accounts Payable (AP ຕ້ອງສົ່ງ)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'receivable' })}
                  className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg ${
                    formData.type === 'receivable' ? 'bg-emerald-500 text-white' : 'text-slate-400'
                  }`}
                >
                  Accounts Receivable (AR ຕ້ອງຮັບ)
                </button>
              </div>

              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">Name / Vendor</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. LATDA, John..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                  value={formData.partyName}
                  onChange={e => setFormData({ ...formData, partyName: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">Amount (LAK)</label>
                <input
                  type="number"
                  required
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-mono font-bold"
                  value={formData.amount || ''}
                  onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Due Date</label>
                  <input
                    type="date"
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs font-bold"
                    value={formData.dueDate}
                    onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[9.5px] font-black uppercase text-slate-400">Phone</label>
                  <input
                    type="text"
                    className="w-full h-10 px-2 rounded-xl bg-slate-50 dark:bg-white/5 border text-xs"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-white/10 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl font-bold shadow-md"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
