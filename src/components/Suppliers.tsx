{/* Product Search & Dropdown Box */}
<div className="space-y-1 relative">
  <input 
    type="text"
    required
    className={`w-full h-10 px-3 pr-8 rounded-xl bg-white dark:bg-[#073069] border text-xs font-bold outline-none cursor-pointer ${
      !item.productId && item.productSearch ? 'border-amber-400' : 'border-slate-200 dark:border-white/10 text-slate-800 dark:text-white'
    }`}
    placeholder={t('search_params') + "..."}
    value={item.isDropdownOpen ? item.productSearch : (selectedProd?.name || item.productSearch)}
    onFocus={() => {
      updateItemRow(index, { isDropdownOpen: true });
    }}
    onClick={() => {
      updateItemRow(index, { isDropdownOpen: true });
    }}
    onChange={(e) => updateItemRow(index, { productSearch: e.target.value, isDropdownOpen: true, productId: '' })}
  />
  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />

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
                quantityPerUnit: p.packSize || 1,
                isDropdownOpen: false
              });
            }}
          >
            <span className="text-xs font-bold text-slate-800 dark:text-white">{p.name}</span>
            <span className="text-[9px] text-slate-400 font-bold uppercase">{p.unit || 'UNIT'}</span>
          </button>
      ))}

      {item.productSearch && !products.some(p => p.name.toLowerCase() === item.productSearch.toLowerCase()) && (
        <button
          type="button"
          className="w-full text-left p-3 bg-primary/5 text-primary text-xs font-bold uppercase cursor-pointer"
          onMouseDown={(e) => {
            e.preventDefault();
            addUnlistedProductForItem(item.productSearch, index);
          }}
        >
          + Add Custom "{item.productSearch}"
        </button>
      )}
    </div>
  )}
</div>
