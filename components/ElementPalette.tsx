'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type ElementEntry = { symbol: string; name: string; number: number; period: number; group: number; family: 'metal' | 'metalloid' | 'nonmetal' | 'noble' };

const elements: ElementEntry[] = [
  ['H','Hydrogen',1,1,1,'nonmetal'],['He','Helium',2,1,18,'noble'],
  ['Li','Lithium',3,2,1,'metal'],['Be','Beryllium',4,2,2,'metal'],['B','Boron',5,2,13,'metalloid'],['C','Carbon',6,2,14,'nonmetal'],['N','Nitrogen',7,2,15,'nonmetal'],['O','Oxygen',8,2,16,'nonmetal'],['F','Fluorine',9,2,17,'nonmetal'],['Ne','Neon',10,2,18,'noble'],
  ['Na','Sodium',11,3,1,'metal'],['Mg','Magnesium',12,3,2,'metal'],['Al','Aluminium',13,3,13,'metal'],['Si','Silicon',14,3,14,'metalloid'],['P','Phosphorus',15,3,15,'nonmetal'],['S','Sulfur',16,3,16,'nonmetal'],['Cl','Chlorine',17,3,17,'nonmetal'],['Ar','Argon',18,3,18,'noble'],
  ['K','Potassium',19,4,1,'metal'],['Ca','Calcium',20,4,2,'metal'],['Sc','Scandium',21,4,3,'metal'],['Ti','Titanium',22,4,4,'metal'],['V','Vanadium',23,4,5,'metal'],['Cr','Chromium',24,4,6,'metal'],['Mn','Manganese',25,4,7,'metal'],['Fe','Iron',26,4,8,'metal'],['Co','Cobalt',27,4,9,'metal'],['Ni','Nickel',28,4,10,'metal'],['Cu','Copper',29,4,11,'metal'],['Zn','Zinc',30,4,12,'metal'],['Ga','Gallium',31,4,13,'metal'],['Ge','Germanium',32,4,14,'metalloid'],['As','Arsenic',33,4,15,'metalloid'],['Se','Selenium',34,4,16,'nonmetal'],['Br','Bromine',35,4,17,'nonmetal'],['Kr','Krypton',36,4,18,'noble'],
  ['Rb','Rubidium',37,5,1,'metal'],['Sr','Strontium',38,5,2,'metal'],['Y','Yttrium',39,5,3,'metal'],['Zr','Zirconium',40,5,4,'metal'],['Nb','Niobium',41,5,5,'metal'],['Mo','Molybdenum',42,5,6,'metal'],['Tc','Technetium',43,5,7,'metal'],['Ru','Ruthenium',44,5,8,'metal'],['Rh','Rhodium',45,5,9,'metal'],['Pd','Palladium',46,5,10,'metal'],['Ag','Silver',47,5,11,'metal'],['Cd','Cadmium',48,5,12,'metal'],['In','Indium',49,5,13,'metal'],['Sn','Tin',50,5,14,'metal'],['Sb','Antimony',51,5,15,'metalloid'],['Te','Tellurium',52,5,16,'metalloid'],['I','Iodine',53,5,17,'nonmetal'],['Xe','Xenon',54,5,18,'noble'],
  ['Cs','Caesium',55,6,1,'metal'],['Ba','Barium',56,6,2,'metal'],['La','Lanthanum',57,6,3,'metal'],['Hf','Hafnium',72,6,4,'metal'],['Ta','Tantalum',73,6,5,'metal'],['W','Tungsten',74,6,6,'metal'],['Re','Rhenium',75,6,7,'metal'],['Os','Osmium',76,6,8,'metal'],['Ir','Iridium',77,6,9,'metal'],['Pt','Platinum',78,6,10,'metal'],['Au','Gold',79,6,11,'metal'],['Hg','Mercury',80,6,12,'metal'],['Tl','Thallium',81,6,13,'metal'],['Pb','Lead',82,6,14,'metal'],['Bi','Bismuth',83,6,15,'metal'],['Po','Polonium',84,6,16,'metalloid'],['At','Astatine',85,6,17,'nonmetal'],['Rn','Radon',86,6,18,'noble'],
  ['Fr','Francium',87,7,1,'metal'],['Ra','Radium',88,7,2,'metal'],['Ac','Actinium',89,7,3,'metal'],['Rf','Rutherfordium',104,7,4,'metal'],['Db','Dubnium',105,7,5,'metal'],['Sg','Seaborgium',106,7,6,'metal'],['Bh','Bohrium',107,7,7,'metal'],['Hs','Hassium',108,7,8,'metal'],['Mt','Meitnerium',109,7,9,'metal'],['Ds','Darmstadtium',110,7,10,'metal'],['Rg','Roentgenium',111,7,11,'metal'],['Cn','Copernicium',112,7,12,'metal'],['Nh','Nihonium',113,7,13,'metal'],['Fl','Flerovium',114,7,14,'metal'],['Mc','Moscovium',115,7,15,'metal'],['Lv','Livermorium',116,7,16,'metal'],['Ts','Tennessine',117,7,17,'nonmetal'],['Og','Oganesson',118,7,18,'noble'],
  ['Ce','Cerium',58,8,3,'metal'],['Pr','Praseodymium',59,8,4,'metal'],['Nd','Neodymium',60,8,5,'metal'],['Pm','Promethium',61,8,6,'metal'],['Sm','Samarium',62,8,7,'metal'],['Eu','Europium',63,8,8,'metal'],['Gd','Gadolinium',64,8,9,'metal'],['Tb','Terbium',65,8,10,'metal'],['Dy','Dysprosium',66,8,11,'metal'],['Ho','Holmium',67,8,12,'metal'],['Er','Erbium',68,8,13,'metal'],['Tm','Thulium',69,8,14,'metal'],['Yb','Ytterbium',70,8,15,'metal'],['Lu','Lutetium',71,8,16,'metal'],
  ['Th','Thorium',90,9,3,'metal'],['Pa','Protactinium',91,9,4,'metal'],['U','Uranium',92,9,5,'metal'],['Np','Neptunium',93,9,6,'metal'],['Pu','Plutonium',94,9,7,'metal'],['Am','Americium',95,9,8,'metal'],['Cm','Curium',96,9,9,'metal'],['Bk','Berkelium',97,9,10,'metal'],['Cf','Californium',98,9,11,'metal'],['Es','Einsteinium',99,9,12,'metal'],['Fm','Fermium',100,9,13,'metal'],['Md','Mendelevium',101,9,14,'metal'],['No','Nobelium',102,9,15,'metal'],['Lr','Lawrencium',103,9,16,'metal'],
].map(([symbol,name,number,period,group,family]) => ({ symbol, name, number, period, group, family } as ElementEntry));

const familyClass: Record<ElementEntry['family'], string> = {
  metal: 'border-[#324156] bg-[#18212e] text-[#a9c7f5]',
  metalloid: 'border-[#344a3a] bg-[#19261e] text-[#a9d4b4]',
  nonmetal: 'border-[#514031] bg-[#2a2119] text-[#e4c3a5]',
  noble: 'border-[#493758] bg-[#241c2c] text-[#d6bce7]',
};

export function ElementPalette({ open, title, selected, onClose, onSelect }: { open: boolean; title: string; selected?: string; onClose: () => void; onSelect: (symbol: string) => void }) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, open]);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? elements.filter((element) => element.symbol.toLowerCase().includes(value) || element.name.toLowerCase().includes(value) || String(element.number) === value) : elements;
  }, [query]);

  return <AnimatePresence>{open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.99 }} className="workspace-dark-surface workspace-element-palette w-full max-w-[760px] overflow-hidden rounded-[10px] border border-[#303030] bg-[#111111] shadow-[0_24px_70px_rgba(0,0,0,.44)]">
      <header className="flex h-12 items-center border-b border-[#e3e5e8] px-4"><span className="text-[12px] font-semibold text-[#30343b]">{title}</span><span className="ml-2 text-[10px] text-[#9499a1]">Choose an atomic species</span><button type="button" onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[5px] text-[#858a92] hover:bg-[#f1f2f4]"><X className="h-4 w-4" /></button></header>
      <div className="border-b border-[#e7e8eb] bg-[#fafbfc] p-3"><label className="flex h-8 items-center gap-2 rounded-[5px] border border-[#d9dce1] bg-white px-2.5 focus-within:border-[var(--field-focus-border)]"><Search className="h-3.5 w-3.5 text-[#8d929a]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, name, or atomic number" className="min-w-0 flex-1 bg-transparent text-[11px] text-[#3e4249] outline-none" /></label></div>
      <div className="max-h-[min(440px,65svh)] overflow-y-auto p-3">
        {!query.trim() ? <><div className="hidden grid-cols-[repeat(18,minmax(0,1fr))] gap-1 md:grid">{elements.map((element) => <button key={element.symbol} type="button" onClick={() => onSelect(element.symbol)} aria-label={`${element.name}, atomic number ${element.number}`} style={{ gridColumn: element.group, gridRow: element.period }} className={cn('group relative aspect-square min-h-8 rounded-[4px] border text-left transition-transform hover:z-10 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-md', familyClass[element.family], selected === element.symbol && 'ring-2 ring-[var(--accent)] ring-offset-1')}><span className="absolute left-1 top-0.5 font-mono text-[8px] opacity-55">{element.number}</span><span className="grid h-full place-items-center pt-1 font-mono text-[11px] font-semibold">{element.symbol}</span></button>)}</div><div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:hidden">{elements.map((element) => <button key={element.symbol} type="button" onClick={() => onSelect(element.symbol)} className={cn('flex h-12 items-center gap-2 rounded-[5px] border px-2 text-left hover:border-[var(--line-strong)]', familyClass[element.family], selected === element.symbol && 'ring-2 ring-[var(--accent)] ring-offset-1')}><span className="font-mono text-[12px] font-semibold">{element.symbol}</span><span className="min-w-0"><span className="block truncate text-[9px]">{element.name}</span><span className="font-mono text-[8px] opacity-60">{element.number}</span></span></button>)}</div></> : <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">{filtered.map((element) => <button key={element.symbol} type="button" onClick={() => onSelect(element.symbol)} className={cn('flex h-12 items-center gap-2 rounded-[5px] border px-2 text-left hover:border-[var(--line-strong)]', familyClass[element.family], selected === element.symbol && 'ring-2 ring-[var(--accent)] ring-offset-1')}><span className="font-mono text-[12px] font-semibold">{element.symbol}</span><span className="min-w-0"><span className="block truncate text-[9px]">{element.name}</span><span className="font-mono text-[8px] opacity-60">{element.number}</span></span></button>)}</div>}
        {query.trim() && !filtered.length && <p className="py-12 text-center text-[11px] text-[#959aa2]">No matching element.</p>}
      </div>
      <footer className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#e4e6e9] bg-[#fafbfc] px-4 py-2 text-[9px] text-[#87919c]"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#d7dce8] bg-[#f5f7fb]" />Metal</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#d7dfd7] bg-[#f3f7f2]" />Metalloid</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#dfd9d3] bg-[#faf7f3]" />Nonmetal</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-[#ddd8e8] bg-[#f8f5fb]" />Noble gas</span></footer>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}
