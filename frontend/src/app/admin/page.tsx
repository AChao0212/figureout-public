"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { convertCurrency, formatCurrency } from "@/lib/currency";

interface Submission {
  id: number; name: string; original_name?: string; character_name?: string;
  franchise_name?: string; manufacturer?: string; version_name?: string;
  series?: string; scale?: string; jan_code?: string; image_url?: string;
  notes?: string; retail_price?: number; retail_currency?: string; figure_type?: string;
  age_rating?: string; material?: string; sculptor?: string;
  painter?: string; illustrator?: string; dimensions?: string; gender?: string;
  release_date?: string; official_url?: string; status: string; created_at?: string;
}
interface ErrorReport {
  id: number; figure_id?: number; report_type: string;
  description: string; contact?: string; status: string; created_at?: string;
}
interface PriceReport {
  id: number; figure_id: number; figure_name?: string;
  price: number; currency: string; condition?: string;
  platform?: string; notes?: string; listing_id?: number; created_at?: string;
}
interface DashboardStats {
  figures: number; figures_with_price: number; listings: number;
  snapshots: number; pending_submissions: number;
  pending_errors: number; total_reports: number; views_today: number;
}
interface ScraperSourceRow {
  source: string; total: number;
  last_scraped_at: string | null;
  last_24h: number; last_7d: number;
}
interface ScraperHealth {
  sources: ScraperSourceRow[];
  suspicious_flags_7d: number;
}
interface AdminFigure {
  id: number; name: string; original_name?: string; manufacturer?: string;
  scale?: string; series?: string; image_url?: string; figure_type?: string;
  release_date?: string; retail_price?: number;
  sculptor?: string; painter?: string; illustrator?: string;
  dimensions?: string; material?: string;
  gender?: string; age_rating?: string; reissue_dates?: string;
  official_url?: string;
}
interface AdminListing {
  id: number; figure_id: number; source: string; source_id?: string;
  title?: string; price?: number; currency?: string; price_canonical?: number;
  condition?: string; is_sold: boolean; url?: string;
  sold_at?: string; scraped_at?: string;
}
interface AdminUser {
  id: number; username: string; role: string; created_at?: string;
}

interface AdminFranchise {
  id: number; name: string; name_zh?: string; figure_count: number;
}
interface AdminCharacter {
  id: number; name: string; name_zh?: string;
  franchise_id?: number; franchise_name?: string; figure_count: number;
}

type Tab = "dashboard" | "submissions" | "errors" | "prices" | "figures" | "franchises" | "characters" | "listings" | "users" | "settings";

// Convert any (price, currency) to a NT$ string using hardcoded fallback rates.
// Admin is internal tooling; live rates aren't required here.
function convertPriceToTWD(price: number, currency: string): string {
  return formatCurrency(convertCurrency(price, currency, "TWD"), "TWD");
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [scraperHealth, setScraperHealth] = useState<ScraperHealth | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [errorReports, setErrorReports] = useState<ErrorReport[]>([]);
  const [priceReports, setPriceReports] = useState<PriceReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ submissions: 0, errors: 0, prices: 0 });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editSubId, setEditSubId] = useState<number | null>(null);
  const [editSubForm, setEditSubForm] = useState<Record<string, any>>({});
  const [figQuery, setFigQuery] = useState("");
  const [figures, setFigures] = useState<AdminFigure[]>([]);
  const [figTotal, setFigTotal] = useState(0);
  const [editingFig, setEditingFig] = useState<AdminFigure | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  // Batch edit (公仔管理 multi-select)
  const [selectedFigIds, setSelectedFigIds] = useState<Set<number>>(new Set());
  const [batchField, setBatchField] = useState("series");
  const [batchValue, setBatchValue] = useState("");
  const [listFigId, setListFigId] = useState("");
  const [adminListings, setAdminListings] = useState<AdminListing[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [editingList, setEditingList] = useState<AdminListing | null>(null);
  const [listEditForm, setListEditForm] = useState<Record<string, any>>({});
  const [highlightListId, setHighlightListId] = useState<number | null>(null);
  const [directFigView, setDirectFigView] = useState(false);
  const [acSuggestions, setAcSuggestions] = useState<{name:string}[]>([]);
  const [acField, setAcField] = useState<string|null>(null);
  const STATIC_OPTIONS: Record<string, string[]> = {
    "_scale": ["1/1", "1/3", "1/4", "1/5", "1/6", "1/7", "1/8", "1/9", "1/10", "1/12"],
    "_figure_type": ["比例人形", "GK", "Q版人形"],
    "_age_rating": ["全年齡", "R18"],
    "_material": ["PVC、ABS", "PVC", "ABS", "ABS、PVC", "塑料", "樹脂", "ATBC-PVC、ABS", "PMMA", "PVC、ABS、金屬"],
  };
  const acAbortRef = (typeof window !== "undefined") ? ((window as any).__fo_ac_abort || ((window as any).__fo_ac_abort = { current: null as AbortController | null })) : { current: null as AbortController | null };
  const fetchAc = async (endpoint: string, q: string, field: string) => {
    if (q.length < 1) { setAcSuggestions([]); setAcField(null); return; }
    if (endpoint.startsWith("_")) {
      const opts = STATIC_OPTIONS[endpoint] || [];
      const filtered = opts.filter(o => o.toLowerCase().includes(q.toLowerCase()));
      setAcSuggestions(filtered.map(name => ({ name })));
      setAcField(field);
      return;
    }
    // Cancel any in-flight autocomplete request so stale results don't overwrite current ones.
    if (acAbortRef.current) { try { acAbortRef.current.abort(); } catch {} }
    const ctrl = new AbortController();
    acAbortRef.current = ctrl;
    try {
      const r = await fetch(`${apiUrl}/browse/autocomplete/${endpoint}?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      if (r.ok) { setAcSuggestions(await r.json()); setAcField(field); }
    } catch { /* aborted or network error; ignore */ }
  };

  // Franchises tab state
  const [franchises, setFranchises] = useState<AdminFranchise[]>([]);
  const [franchiseQ, setFranchiseQ] = useState("");
  const [franchiseTotal, setFranchiseTotal] = useState(0);
  const [editingFranchise, setEditingFranchise] = useState<AdminFranchise | null>(null);
  const [franchiseForm, setFranchiseForm] = useState<{ name: string; name_zh: string }>({ name: "", name_zh: "" });

  // Characters tab state
  const [characters, setCharacters] = useState<AdminCharacter[]>([]);
  const [characterQ, setCharacterQ] = useState("");
  const [characterTotal, setCharacterTotal] = useState(0);
  const [editingCharacter, setEditingCharacter] = useState<AdminCharacter | null>(null);
  const [characterForm, setCharacterForm] = useState<{ name: string; name_zh: string }>({ name: "", name_zh: "" });

  // Users tab state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [userMsg, setUserMsg] = useState("");

  // Notes state (inline in figure edit)
  const [adminNotes, setAdminNotes] = useState<any[]>([]);
  const [figureNotes, setFigureNotes] = useState<any[]>([]);

  // Settings tab state
  const [settingsBest, setSettingsBest] = useState("");
  const [settingsWorst, setSettingsWorst] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
 const btn = "px-3 py-1.5 text-xs font-medium transition-colors";
 const card = "border border-[var(--rule)] bg-[var(--ground-lift)] p-4";
 const inp = "w-full border border-[var(--rule)] bg-[var(--ground)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--muted)] focus:border-[var(--ink)] focus:outline-none";

  const getToken = () => typeof window !== "undefined" ? localStorage.getItem("figureout_token") || localStorage.getItem("admin_token") || "" : "";
  const authHeaders = () => ({ "Authorization": `Bearer ${getToken()}`, "Content-Type": "application/json" });

  const fetchStats = async () => {
    try {
      const r = await fetch(`${apiUrl}/admin/dashboard`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setStats(d);
        setCounts({ submissions: d.pending_submissions, errors: d.pending_errors, prices: d.total_reports });
      }
    } catch {}
    // Scraper health is best-effort; missing data shouldn't block the dashboard.
    try {
      const r = await fetch(`${apiUrl}/admin/scraper-health`, { headers: authHeaders() });
      if (r.ok) setScraperHealth(await r.json());
    } catch {}
  };
  const fetchData = async (t: Tab) => {
    setLoading(true);
    try {
      if(t==="dashboard") await fetchStats();
      else if(t==="submissions"){const r=await fetch(`${apiUrl}/admin/submissions?status=pending`, { headers: authHeaders() });if(r.ok){const d=await r.json();setSubmissions(d.items);setCounts(c=>({...c,submissions:d.total}));}}
      else if(t==="errors"){const r=await fetch(`${apiUrl}/admin/error-reports?status=pending`, { headers: authHeaders() });if(r.ok){const d=await r.json();setErrorReports(d.items);setCounts(c=>({...c,errors:d.total}));}}
      else if(t==="prices"){const r=await fetch(`${apiUrl}/admin/price-reports`, { headers: authHeaders() });if(r.ok){const d=await r.json();setPriceReports(d.items);setCounts(c=>({...c,prices:d.total}));}}
      else if(t==="franchises") await fetchFranchises(franchiseQ);
      else if(t==="characters") await fetchCharacters(characterQ);
      else if(t==="users") await fetchUsers();
      else if(t==="settings") await fetchSettings();
    }catch{}
    setLoading(false);
  };
  const [authed, setAuthed] = useState(false);
  useEffect(()=>{
    const token = localStorage.getItem("figureout_token") || localStorage.getItem("admin_token");
    if(!token){router.push("/login");return;}
    fetch(`${apiUrl}/user/me`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => { if(!r.ok) throw new Error("unauthorized"); return r.json(); })
      .then(() => {
        setAuthed(true); fetchStats();
        // Auto-open figure from URL param (e.g. /admin?editFigure=13943)
        const editId = new URLSearchParams(window.location.search).get("editFigure");
        if (editId) {
          setTimeout(() => jumpToFigure(parseInt(editId)), 300);
        }
      })
      .catch(() => { router.push("/login"); });
  },[]);
  useEffect(()=>{setSelectedFigIds(new Set());fetchData(tab);},[tab]);

  const handleApprove=async(id:number)=>{try{const r=await fetch(`${apiUrl}/admin/submissions/${id}/approve`,{method:"POST",headers:authHeaders()});if(r.ok){const d=await r.json();alert(`已通過！公仔 ID: ${d.figure_id}`);setSubmissions(s=>s.filter(x=>x.id!==id));setCounts(c=>({...c,submissions:c.submissions-1}));}else{const e=await r.json().catch(()=>({detail:"未知錯誤"}));alert(`操作失敗: ${e.detail||r.statusText}`);if(r.status===401){localStorage.removeItem("admin_token");localStorage.removeItem("figureout_token");router.push("/login");}}}catch(err){alert("網路錯誤，請重試");}};
  const handleReject=async(id:number)=>{if(!confirm("確定要拒絕？"))return;const r=await fetch(`${apiUrl}/admin/submissions/${id}/reject`,{method:"POST",headers:authHeaders()});if(r.ok){setSubmissions(s=>s.filter(x=>x.id!==id));setCounts(c=>({...c,submissions:c.submissions-1}));}};
  const handleSaveSubmission=async(id:number)=>{const saveForm={...editSubForm};try{const r=await fetch(`${apiUrl}/admin/submissions/${id}`,{method:"PUT",headers:authHeaders(),body:JSON.stringify(saveForm)});if(r.ok){setEditSubId(null);setEditSubForm({});await fetchData("submissions");}else{const e=await r.json().catch(()=>({}));alert(e.detail||"儲存失敗");}}catch{alert("儲存失敗");}};
  const handleResolve=async(id:number)=>{const r=await fetch(`${apiUrl}/admin/error-reports/${id}/resolve`,{method:"POST",headers:authHeaders()});if(r.ok){setErrorReports(x=>x.filter(v=>v.id!==id));setCounts(c=>({...c,errors:c.errors-1}));}};
  const handleDismiss=async(id:number)=>{const r=await fetch(`${apiUrl}/admin/error-reports/${id}/dismiss`,{method:"POST",headers:authHeaders()});if(r.ok){setErrorReports(x=>x.filter(v=>v.id!==id));setCounts(c=>({...c,errors:c.errors-1}));}};
  const handleDeletePrice=async(id:number)=>{if(!confirm("確定刪除此價格回報？"))return;const r=await fetch(`${apiUrl}/admin/price-reports/${id}`,{method:"DELETE",headers:authHeaders()});if(r.ok){setPriceReports(p=>p.filter(x=>x.id!==id));setCounts(c=>({...c,prices:Math.max(0,c.prices-1)}));}else alert("刪除失敗");};

  const searchFigures=useCallback(async(q:string)=>{setDirectFigView(false);setSelectedFigIds(new Set());setLoading(true);try{const r=await fetch(`${apiUrl}/admin/figures?q=${encodeURIComponent(q)}&limit=150`, { headers: authHeaders() });if(r.ok){const d=await r.json();setFigures(d.items);setFigTotal(d.total);}}catch{}setLoading(false);},[apiUrl]);
  const loadFigureNotes=async(figId:number)=>{try{const r=await fetch(apiUrl+"/figures/"+figId+"/notes");if(r.ok)setFigureNotes(await r.json());else setFigureNotes([]);}catch{setFigureNotes([]);}};
  const deleteFigureNote=async(noteId:number,figId:number)=>{if(!confirm("確定刪除此筆記？"))return;const r=await fetch(apiUrl+"/admin/notes/"+noteId,{method:"DELETE",headers:authHeaders()});if(r.ok){setFigureNotes(n=>n.filter(x=>x.id!==noteId));setErrorReports(er=>er.filter(x=>!(x.report_type==="note_abuse"&&x.description.includes("Note #"+noteId+" "))));}};
  const startEditFig=async(id:number)=>{const r=await fetch(`${apiUrl}/admin/figures/${id}`, { headers: authHeaders() });if(r.ok){const d=await r.json();setEditingFig(d);setEditForm({...d,_character_name:d.character_name||"",_franchise_name:d.franchise_name||""});loadFigureNotes(id);}};
  const saveFigure=async()=>{if(!editingFig)return;
    const saveData={...editForm};
    // Handle character/franchise reassignment
    if(saveData._character_name||saveData._franchise_name){
      saveData.character_name=saveData._character_name;
      saveData.franchise_name=saveData._franchise_name;
    }
    delete saveData._character_name;
    delete saveData._franchise_name;
    const r=await fetch(`${apiUrl}/admin/figures/${editingFig.id}`,{method:"PUT",headers:authHeaders(),body:JSON.stringify(saveData)});if(r.ok){alert("已更新");if(directFigView){startEditFig(editingFig.id);}else{setEditingFig(null);searchFigures(figQuery);}}else{const err=await r.text();alert("更新失敗: "+err);}};
  const deleteFigure=async(id:number)=>{if(!confirm(`確定刪除公仔 #${id}？`))return;const r=await fetch(`${apiUrl}/admin/figures/${id}`,{method:"DELETE",headers:authHeaders()});if(r.ok){setFigures(f=>f.filter(x=>x.id!==id));setSelectedFigIds(s=>{const n=new Set(s);n.delete(id);return n;});}else{const e=await r.json().catch(()=>({}));alert(e.detail||`刪除失敗（${r.status}）`);}};
  const toggleFigSel=(id:number)=>setSelectedFigIds(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleSelAll=()=>setSelectedFigIds(s=>s.size===figures.length?new Set():new Set(figures.map(f=>f.id)));
  // __franchise__ and __character__ are pseudo-fields that route to dedicated
  // endpoints (find-or-create the entity, write FK). For 角色 we scope the
  // find-or-create to each figure's existing franchise_id, so 角色 alone works
  // independently of 作品 (parallel batch fields, per editor request).
  const BATCH_FIELDS:[string,string,string][]=[["系列","series","series"],["作品","__franchise__","franchises"],["角色","__character__","characters"],["製造商","manufacturer","manufacturers"],["比例","scale","_scale"],["類型","figure_type","_figure_type"],["年齡分級","age_rating","_age_rating"],["材質","material","_material"],["性別","gender",""],["原型師","sculptor","sculptors"],["塗裝師","painter","painters"],["原畫","illustrator","illustrators"],["發售日","release_date",""],["再販日期","reissue_dates",""],["尺寸","dimensions",""],["版本","version_name",""],["官方頁面","official_url",""]];
  const batchUpdate=async()=>{const ids=Array.from(selectedFigIds);if(ids.length===0)return;const v=batchValue.trim();if(batchField==="__franchise__"||batchField==="__character__"){if(!v){alert("作品/角色名稱不能為空");return;}return batchUpdateRelation(ids,v);}const label=BATCH_FIELDS.find(b=>b[1]===batchField)?.[0]||batchField;if(!confirm(`把 ${ids.length} 個公仔的「${label}」設為「${batchValue||"(清空)"}」？`))return;setLoading(true);try{const r=await fetch(`${apiUrl}/admin/figures/batch-update`,{method:"POST",headers:authHeaders(),body:JSON.stringify({ids,field:batchField,value:batchValue||null})});if(r.ok){const d=await r.json();alert(`已更新 ${d.updated} 個公仔`);setSelectedFigIds(new Set());setBatchValue("");if(figQuery)searchFigures(figQuery);}else{const e=await r.json().catch(()=>({}));alert(e.detail||`批次更新失敗（${r.status}）`);}}catch{alert("批次更新失敗");}setLoading(false);};
  const batchUpdateRelation=async(ids:number[],value:string)=>{const isFranchise=batchField==="__franchise__";const labelZh=isFranchise?"作品":"角色";const endpoint=isFranchise?"batch-update-franchise":"batch-update-character";const payload=isFranchise?{ids,franchise_name:value}:{ids,character_name:value};if(!confirm(`把 ${ids.length} 個公仔的「${labelZh}」設為「${value}」？\n${isFranchise?"若該作品尚未存在,將自動建立。":"若該作品下尚無此角色,將自動建立。沒有作品的 figure 會被跳過。"}\n此操作沒有 undo。`))return;setLoading(true);try{const r=await fetch(`${apiUrl}/admin/figures/${endpoint}`,{method:"POST",headers:authHeaders(),body:JSON.stringify(payload)});if(r.ok){const d=await r.json();const extras=[];if(d.franchise_created)extras.push("新作品已建立");if(d.characters_created)extras.push(`${d.characters_created} 個新角色建立`);if(d.skipped_no_franchise)extras.push(`${d.skipped_no_franchise} 個因無作品跳過`);alert(`已更新 ${d.updated} 個公仔${extras.length?`\n${extras.join("、")}`:""}`);setSelectedFigIds(new Set());setBatchValue("");if(figQuery)searchFigures(figQuery);}else{const e=await r.json().catch(()=>({}));alert(e.detail||`批次更新失敗（${r.status}）`);}}catch{alert("批次更新失敗");}setLoading(false);};
  const searchListings=async(fid:string)=>{if(!fid.trim())return;setLoading(true);try{const r=await fetch(`${apiUrl}/admin/figures/${fid}/listings?limit=100`, { headers: authHeaders() });if(r.ok){const d=await r.json();setAdminListings(d.items);setListTotal(d.total);}}catch{}setLoading(false);};
  const startEditList=(l:AdminListing)=>{setEditingList(l);setListEditForm({...l});};
  const saveList=async()=>{if(!editingList)return;const r=await fetch(`${apiUrl}/admin/listings/${editingList.id}`,{method:"PUT",headers:authHeaders(),body:JSON.stringify(listEditForm)});if(r.ok){alert("已更新");setEditingList(null);searchListings(listFigId);}else alert("更新失敗");};
  const deleteList=async(id:number)=>{if(!confirm(`確定刪除？`))return;const r=await fetch(`${apiUrl}/admin/listings/${id}`,{method:"DELETE",headers:authHeaders()});if(r.ok){setAdminListings(l=>l.filter(x=>x.id!==id));}else{const e=await r.json().catch(()=>({}));alert(e.detail||`刪除失敗（${r.status}）`);}};

  const jumpToListing = async (figureId: number, listingId: number) => {
    setTab("listings");
    const fid = String(figureId);
    setListFigId(fid);
    setHighlightListId(listingId);
    setLoading(true);
    try {
      const r = await fetch(`${apiUrl}/admin/figures/${fid}/listings?limit=100`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setAdminListings(d.items); setListTotal(d.total); }
    } catch {}
    setLoading(false);
    setTimeout(() => setHighlightListId(null), 5000);
  };

  const jumpToFigure = async (figureId: number, highlightListId?: number) => {
    setTab("figures");
    setDirectFigView(true);
    setFigQuery("");
    setLoading(true);
    // Fetch figure data and open edit form
    try {
      const r = await fetch(`${apiUrl}/admin/figures/${figureId}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setEditingFig(d);
        setEditForm({...d, _character_name: d.character_name || "", _franchise_name: d.franchise_name || ""});
        setFigures([d]);
        setFigTotal(1);
      }
    } catch {}
    // Load notes for this figure
    loadFigureNotes(figureId);
    // Also load listings
    const fid = String(figureId);
    setListFigId(fid);
    if (highlightListId) setHighlightListId(highlightListId);
    try {
      const r2 = await fetch(`${apiUrl}/admin/figures/${fid}/listings?limit=100`, { headers: authHeaders() });
      if (r2.ok) { const d2 = await r2.json(); setAdminListings(d2.items); setListTotal(d2.total); }
    } catch {}
    setLoading(false);
    if (highlightListId) {
      // Auto-scroll to highlighted listing after render
      setTimeout(() => {
        const el = document.getElementById(`listing-${highlightListId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
      setTimeout(() => setHighlightListId(null), 5000);
    }
  };

  // --- Users tab ---
  const fetchUsers = async () => {
    try {
      const r = await fetch(`${apiUrl}/auth/users`, { headers: authHeaders() });
      if (r.ok) setUsers(await r.json());
      else if (r.status === 401 || r.status === 403) setUserMsg("需要超級管理員權限，請先登入。");
    } catch { setUserMsg("載入失敗"); }
  };
  const createUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) { setUserMsg("帳號和密碼不可為空"); return; }
    setUserMsg("");
    try {
      const r = await fetch(`${apiUrl}/auth/users`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      if (r.ok) {
        setNewUsername(""); setNewPassword(""); setNewRole("editor");
        setUserMsg("帳號建立成功");
        fetchUsers();
      } else {
        const d = await r.json().catch(() => ({}));
        setUserMsg(d.detail || "建立失敗");
      }
    } catch { setUserMsg("連線失敗"); }
  };
  const deleteUser = async (id: number, username: string) => {
    if (!confirm(`確定刪除帳號「${username}」？`)) return;
    try {
      const r = await fetch(`${apiUrl}/auth/users/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok) { setUsers(u => u.filter(x => x.id !== id)); setUserMsg("已刪除"); }
      else { const d = await r.json().catch(() => ({})); setUserMsg(d.detail || "刪除失敗"); }
    } catch { setUserMsg("連線失敗"); }
  };

  // --- Settings tab ---
  const fetchSettings = async () => {
    try {
      const r = await fetch(`${apiUrl}/admin/config`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        const best = d.trending_best_titles;
        const worst = d.trending_worst_titles;
        try { const p = typeof best === "string" ? JSON.parse(best) : best; setSettingsBest(Array.isArray(p) ? p.join("\n") : String(best || "")); } catch { setSettingsBest(String(best || "")); }
        try { const p = typeof worst === "string" ? JSON.parse(worst) : worst; setSettingsWorst(Array.isArray(p) ? p.join("\n") : String(worst || "")); } catch { setSettingsWorst(String(worst || "")); }
      }
    } catch {}
  };
  const saveConfig = async (key: string, value: string) => {
    setSettingsMsg("");
    const lines = value.split("\n").map(s => s.trim()).filter(Boolean);
    const jsonStr = JSON.stringify(lines);
    try {
      const r = await fetch(`${apiUrl}/admin/config/${key}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ value: jsonStr }),
      });
      if (r.ok) setSettingsMsg(`${key} 已儲存`);
      else setSettingsMsg("儲存失敗");
    } catch { setSettingsMsg("連線失敗"); }
  };

  // --- Franchises & Characters ---
  const fetchFranchises = async (q: string) => {
    try {
      const r = await fetch(`${apiUrl}/admin/franchises?q=${encodeURIComponent(q)}&limit=100`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setFranchises(d.items); setFranchiseTotal(d.total); }
    } catch {}
  };
  const saveFranchise = async () => {
    if (!editingFranchise) return;
    const name = franchiseForm.name.trim();
    if (!name) { alert("名稱不可為空"); return; }
    try {
      const r = await fetch(`${apiUrl}/admin/franchises/${editingFranchise.id}`, {
        method: "PUT", headers: authHeaders(),
        body: JSON.stringify({ name, name_zh: franchiseForm.name_zh.trim() || null }),
      });
      if (r.ok) {
        const d = await r.json();
        setFranchises(xs => xs.map(x => x.id === d.id ? { ...x, name: d.name, name_zh: d.name_zh } : x));
        setEditingFranchise(null);
      } else {
        const e = await r.json().catch(() => ({}));
        alert(e.detail || "儲存失敗");
      }
    } catch { alert("網路錯誤"); }
  };
  const fetchCharacters = async (q: string) => {
    try {
      const r = await fetch(`${apiUrl}/admin/characters?q=${encodeURIComponent(q)}&limit=100`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setCharacters(d.items); setCharacterTotal(d.total); }
    } catch {}
  };
  const saveCharacter = async () => {
    if (!editingCharacter) return;
    const name = characterForm.name.trim();
    if (!name) { alert("名稱不可為空"); return; }
    try {
      const r = await fetch(`${apiUrl}/admin/characters/${editingCharacter.id}`, {
        method: "PUT", headers: authHeaders(),
        body: JSON.stringify({ name, name_zh: characterForm.name_zh.trim() || null }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.warning) {
          if (!confirm(d.warning + "\n仍要儲存嗎？")) {
            // Revert: re-fetch to get original name back, reset form state
            await fetchCharacters(characterQ);
            setEditingCharacter(null);
            setCharacterForm({ name: "", name_zh: "" });
            return;
          }
        }
        setCharacters(xs => xs.map(x => x.id === d.id ? { ...x, name: d.name, name_zh: d.name_zh } : x));
        setEditingCharacter(null);
      } else {
        const e = await r.json().catch(() => ({}));
        alert(e.detail || "儲存失敗");
      }
    } catch { alert("網路錯誤"); }
  };

 const Stat=({label,value,accent}:{label:string;value:number|string;accent?:boolean})=>(<div className={card}><span className="lbl">{label}</span><p className={`num text-2xl leading-none ${accent?"text-[var(--ink)]":"text-[var(--ink-2)]"}`}>{typeof value==="number"?value.toLocaleString():value}</p></div>);
 const Info=({label,value}:{label:string;value?:string|number|null})=>(<div className="flex items-start gap-2 text-xs"><span className="shrink-0 text-[var(--muted)]">{label}</span><span className={value?"text-[var(--ink)]":"text-[var(--muted)]"}>{value??"未填"}</span></div>);
 const EF=({label,field,form,setForm,type="text"}:{label:string;field:string;form:Record<string,any>;setForm:(f:Record<string,any>)=>void;type?:string})=>(<div><label className="mb-1 block text-[10px] text-[var(--muted)]">{label}</label><input type={type} value={form[field]??""} onChange={e=>setForm({...form,[field]:type==="number"?(e.target.value?Number(e.target.value):null):e.target.value})} className={inp}/></div>);

  const tabs:{key:Tab;label:string;badge?:number}[]=[{key:"dashboard",label:"總覽"},{key:"submissions",label:"公仔提交",badge:counts.submissions},{key:"errors",label:"錯誤回報",badge:counts.errors},{key:"prices",label:"價格回報",badge:counts.prices},{key:"figures",label:"公仔管理"},{key:"franchises",label:"作品管理"},{key:"characters",label:"角色管理"},{key:"users",label:"帳號管理"},{key:"settings",label:"網站設定"}];

 if (!authed) return <div className="flex h-screen items-center justify-center"><p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">驗證中</p></div>;

  return (
    <div className="col pb-10 pt-[clamp(24px,4.5vh,46px)]">
      <span className="lbl">Admin</span>
      <h1 className="display">管理後台</h1>
      <p className="mb-6 mt-3 text-sm text-[var(--ink-2)]">審核提交、回報管理、平台數據一覽</p>
      <div className="mb-6 flex gap-x-6 overflow-x-auto border-b border-[var(--rule)] pb-3 scrollbar-none">
        {tabs.map(t=>(<button key={t.key} onClick={()=>setTab(t.key)} className="seg shrink-0" aria-pressed={tab===t.key}>{t.label}{t.badge!=null&&t.badge>0&&<span className="num ml-1.5 text-[10px] text-[var(--ink)]">{t.badge}</span>}</button>))}
      </div>
      {loading&&<p className="py-10 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">載入中</p>}

      {tab==="dashboard"&&!loading&&stats&&(
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="公仔總數" value={stats.figures} accent/>
            <Stat label="有價格資料" value={stats.figures_with_price}/>
            <Stat label="成交紀錄" value={stats.listings}/>
            <Stat label="今日瀏覽" value={stats.views_today}/>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="價格快照" value={stats.snapshots}/>
            <Stat label="用戶回報" value={stats.total_reports}/>
            <Stat label="待審提交" value={stats.pending_submissions} accent={stats.pending_submissions>0}/>
            <Stat label="待處理錯誤" value={stats.pending_errors} accent={stats.pending_errors>0}/>
          </div>

          {/* Scraper health — surfaces silent outages by showing per-source last_scraped_at + recent volume */}
          {scraperHealth && (
            <div className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--ink)]">Scraper 健康</h3>
                {scraperHealth.suspicious_flags_7d > 0 && (
                  <span className="rounded-full bg-[var(--hue-red)]/10 px-2 py-0.5 text-[10px] text-[var(--hue-red)]">
                    7 天內 {scraperHealth.suspicious_flags_7d} 筆可疑被旗標
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="pb-2 pr-3">來源</th>
                      <th className="pb-2 pr-3 text-right">總數</th>
                      <th className="pb-2 pr-3 text-right">24h 新增</th>
                      <th className="pb-2 pr-3 text-right">7d 新增</th>
                      <th className="pb-2">最近抓取</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ground-lift)]">
                    {scraperHealth.sources.map(s => {
 const ago = s.last_scraped_at
                        ? Math.floor((Date.now() - new Date(s.last_scraped_at).getTime()) / 3600000)
                        : null;
                      // Stale = no new listings in > 48h. Highlights silent outages.
 const stale = ago != null && ago > 48;
 return (
                        <tr key={s.source}>
                          <td className="py-2 pr-3 font-medium text-[var(--ink)]">{s.source}</td>
                          <td className="py-2 pr-3 text-right text-[var(--ink)]">{s.total.toLocaleString()}</td>
                          <td className={"py-2 pr-3 text-right " + (s.last_24h > 0 ? "text-[var(--hue-green)]" : "text-[var(--muted)]")}>
                            {s.last_24h.toLocaleString()}
                          </td>
                          <td className="py-2 pr-3 text-right text-[var(--ink)]">{s.last_7d.toLocaleString()}</td>
                          <td className={"py-2 " + (stale ? "text-[var(--hue-red)]" : "text-[var(--ink-2)]")}>
                            {ago == null ? "—" : ago < 24 ? `${ago} 小時前` : `${Math.floor(ago/24)} 天前`}
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
      )}

      {tab==="submissions"&&!loading&&(<div className="space-y-3">{submissions.length===0?<div className={card+" text-center"}><p className="text-sm text-[var(--muted)]">沒有待審核的提交</p></div>:submissions.map(s=>(<div key={s.id} className={card}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2">{s.image_url&&<img src={s.image_url} alt="" className="h-12 w-12 shrink-0 border border-[var(--rule)] object-contain"/>}<div className="min-w-0"><p className="truncate font-medium text-[var(--ink)]">{s.name}</p>{s.original_name&&<p className="truncate text-xs text-[var(--muted)]">{s.original_name}</p>}</div></div><button onClick={()=>setExpandedId(expandedId===s.id?null:s.id)} className="mt-2 text-[10px] text-[var(--ink)] hover:underline">{expandedId===s.id?"收起":"詳情"}</button>{expandedId===s.id&&(<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><Info label="角色" value={s.character_name}/><Info label="作品" value={s.franchise_name}/><Info label="製造商" value={s.manufacturer}/><Info label="系列" value={s.series}/><Info label="比例" value={s.scale}/><Info label="類型" value={s.figure_type}/></div>)}{editSubId===s.id&&(<div className="mt-3 border border-[var(--ink)]/30 bg-[var(--ground)] p-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([["名稱","name",""],["原名","original_name",""],["角色","character_name","characters"],["作品","franchise_name","franchises"],["製造商","manufacturer","manufacturers"],["比例","scale","_scale"],["系列","series","series"],["JAN","jan_code",""],["圖片網址","image_url",""],["類型","figure_type","_figure_type"],["年齡分級","age_rating","_age_rating"],["材質","material","_material"],["原型師","sculptor","sculptors"],["塗裝師","painter","painters"],["原畫","illustrator","illustrators"],["尺寸","dimensions",""],["性別","gender",""],["發售日","release_date",""],["官方頁面","official_url",""],["備注","notes",""]] as [string,string,string][]).map(([label,field,ep])=>{const isAc=!!ep;return(<div key={field} className="relative"><label className="mb-1 block text-[10px] text-[var(--muted)]">{label}</label><input value={editSubForm[field]??""}onChange={e=>{setEditSubForm(f=>({...f,[field]:e.target.value}));if(isAc)fetchAc(ep,e.target.value,field);}} onBlur={()=>setTimeout(()=>{if(acField===field){setAcSuggestions([]);setAcField(null);}},200)} className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-2 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"/>{isAc&&acField===field&&acSuggestions.length>0&&(<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto border border-[var(--rule)] bg-[var(--ground-lift)] shadow-lg">{acSuggestions.map((s,i)=>(<button key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>{setEditSubForm(f=>({...f,[field]:s.name}));setAcSuggestions([]);setAcField(null);}} className="w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--ground-lift)]">{s.name}</button>))}</div>)}</div>);})}<div className="relative"><label className="mb-1 block text-[10px] text-[var(--muted)]">定價</label><div className="flex gap-1"><input value={editSubForm.retail_price??""} onChange={e=>setEditSubForm(f=>({...f,retail_price:e.target.value}))} placeholder={editSubForm.retail_currency==="CNY"?"例：780":"例：16800"} className="w-full rounded-l border border-[var(--rule)] bg-[var(--ground-lift)] px-2 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]"/><button type="button" onClick={()=>setEditSubForm(f=>({...f,retail_currency:f.retail_currency==="CNY"?"JPY":"CNY"}))} className={`shrink-0 rounded-r border px-2 py-1 text-[10px] font-medium ${editSubForm.retail_currency==="CNY"?"border-[var(--hue-red)] bg-[var(--hue-red)]/20 text-[var(--hue-red)]":"border-[var(--ink)] bg-[var(--ink)]/20 text-[var(--ink)]"}`}>{editSubForm.retail_currency||"JPY"}</button></div></div></div><div className="mt-2 flex gap-2"><button onClick={()=>handleSaveSubmission(s.id)} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>{setEditSubId(null);setEditSubForm({});}} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div></div>)}</div><div className="flex shrink-0 gap-2"><button onClick={()=>{setEditSubId(editSubId===s.id?null:s.id);setEditSubForm({name:s.name,original_name:s.original_name||"",character_name:s.character_name||"",franchise_name:s.franchise_name||"",manufacturer:s.manufacturer||"",scale:s.scale||"",retail_price:s.retail_price||"",retail_currency:(s as any).retail_currency||"JPY",series:s.series||"",jan_code:s.jan_code||"",image_url:s.image_url||"",figure_type:s.figure_type||"",age_rating:s.age_rating||"",material:s.material||"",sculptor:s.sculptor||"",painter:s.painter||"",illustrator:s.illustrator||"",dimensions:s.dimensions||"",gender:s.gender||"",release_date:s.release_date||"",official_url:s.official_url||"",notes:s.notes||""});}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button><button onClick={()=>handleApprove(s.id)} className={btn+" bg-green-900/50 text-green-400 hover:bg-green-900/80"}>通過</button><button onClick={()=>handleReject(s.id)} className={btn+" bg-red-900/50 text-red-400 hover:bg-red-900/80"}>拒絕</button></div></div></div>))}</div>)}

      {tab==="errors"&&!loading&&(<div className="space-y-3">{errorReports.length===0?<div className={card+" text-center"}><p className="text-sm text-[var(--muted)]">沒有待處理的錯誤回報</p></div>:errorReports.map(r=>{const typeLabels:Record<string,string>={"wrong_price":"價格錯誤","wrong_item":"商品錯誤","duplicate":"重複紀錄","note_abuse":"筆記濫用","editor_application":"編輯者申請"};const isEditorApp=r.report_type==="editor_application";return(<div key={r.id} className={card+(isEditorApp?" border-[var(--ink)]/30":"")}><div className="flex items-start justify-between gap-3"><div className="flex-1"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isEditorApp?"bg-[var(--ink)]/20 text-[var(--ink)]":r.report_type==="wrong_price"||r.report_type==="note_abuse"?"bg-[var(--hue-red)]/10 text-[var(--hue-red)]":"bg-[var(--ground-lift)] text-[var(--ink-2)]"}`}>{typeLabels[r.report_type]||r.report_type}</span>{r.figure_id&&<a href={"/figures/"+r.figure_id} className="text-xs text-[var(--ink)] hover:underline">{"公仔 #"+r.figure_id}</a>}</div><p className="mt-1.5 text-sm text-[var(--ink)]">{r.description}</p>{r.contact&&<p className="mt-1 text-xs text-[var(--muted)]">{"聯絡: "+r.contact}</p>}</div><div className="flex shrink-0 gap-2">{isEditorApp?<><button onClick={async()=>{if(!confirm("確定要授予此使用者編輯者權限？"))return;const res=await fetch(apiUrl+"/user/approve-editor/"+r.id,{method:"POST",headers:authHeaders()});if(res.ok){const d=await res.json();alert("已通過！"+d.username+" 成為編輯者");setErrorReports(x=>x.filter(v=>v.id!==r.id));setCounts(c=>({...c,errors:c.errors-1}));}else{const e=await res.json().catch(()=>({}));alert(e.detail||"操作失敗");}}} className={btn+" bg-green-900/50 text-green-400 hover:bg-green-900/80"}>通過</button><button onClick={async()=>{if(!confirm("確定要拒絕此申請？"))return;const res=await fetch(apiUrl+"/user/reject-editor/"+r.id,{method:"POST",headers:authHeaders()});if(res.ok){setErrorReports(x=>x.filter(v=>v.id!==r.id));setCounts(c=>({...c,errors:c.errors-1}));}}} className={btn+" bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>拒絕</button></>:r.report_type==="note_abuse"&&r.figure_id?<button onClick={()=>{jumpToFigure(r.figure_id!);setTimeout(()=>{const el=document.getElementById("figure-notes-section");if(el)el.scrollIntoView({behavior:"smooth",block:"center"});},1000);}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>查看筆記</button>:r.figure_id&&<button onClick={()=>{const m=(r.description||"").match(/Listing #(\d+)/);jumpToFigure(r.figure_id!,m?parseInt(m[1]):undefined);}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>查看公仔</button>}{!isEditorApp&&<><button onClick={()=>handleResolve(r.id)} className={btn+" bg-green-900/50 text-green-400 hover:bg-green-900/80"}>已解決</button><button onClick={()=>handleDismiss(r.id)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)]"}>忽略</button></>}</div></div><p className="mt-2 text-[10px] text-[var(--muted)]">{r.created_at?new Date(r.created_at).toLocaleString("zh-TW"):""}</p></div>);})}</div>)}

      {tab==="prices"&&!loading&&(<div className="space-y-3">{priceReports.length===0?<div className={card+" text-center"}><p className="text-sm text-[var(--muted)]">沒有價格回報</p></div>:(<div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]"><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">公仔</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">原始價格</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">換算TWD</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">狀態</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">平台</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">時間</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{priceReports.map(p=>(<tr key={p.id} className="border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)]"><td className="px-3 py-2"><a href={`/figures/${p.figure_id}`} className="text-[var(--ink)] hover:underline">{p.figure_name||`#${p.figure_id}`}</a></td><td className="whitespace-nowrap px-3 py-2 text-[var(--ink)]">{p.price.toLocaleString()} {p.currency}</td><td className="whitespace-nowrap px-3 py-2 text-[var(--ink-2)]">{p.currency==="TWD"?"-":convertPriceToTWD(p.price,p.currency)}</td><td className="px-3 py-2 text-[var(--ink-2)]">{p.condition||"-"}</td><td className="px-3 py-2 text-[var(--ink-2)]">{p.platform||"-"}</td><td className="px-3 py-2 text-[10px] text-[var(--muted)]">{p.created_at?new Date(p.created_at).toLocaleString("zh-TW"):""}</td><td className="px-3 py-2"><button onClick={()=>jumpToFigure(p.figure_id, p.listing_id)} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>查看</button><button onClick={()=>handleDeletePrice(p.id)} className={btn+" bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button></td></tr>))}</tbody></table></div>)}</div>)}

      {tab==="figures"&&(<div className="space-y-4">
        <div className="flex gap-2"><button onClick={async()=>{setLoading(true);try{const r=await fetch(apiUrl+"/admin/figures-below-threshold?limit=200",{headers:authHeaders()});if(r.ok){const d=await r.json();setFigures(d.items);setFigTotal(d.total);setDirectFigView(false);}}catch{}setLoading(false);}} className={btn+" shrink-0 border border-[var(--hue-red)]/30 text-[var(--hue-red)] hover:bg-[var(--hue-red)]/10"}>低價公仔 ({"<"}NT)</button><input type="text" placeholder="搜尋公仔名稱、製造商..." value={figQuery} onChange={e=>setFigQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchFigures(figQuery)} className={inp+" flex-1"}/><button onClick={()=>searchFigures(figQuery)} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>搜尋</button></div>
        {figures.length>0&&<p className="text-xs text-[var(--muted)]">共 {figTotal} 筆結果</p>}
        {editingFig&&(<div className="border border-[var(--ink)]/30 bg-[var(--ground-lift)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">編輯公仔 #{editingFig.id}</h3><button onClick={()=>{setEditingFig(null);setDirectFigView(false);}} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{([["名稱","name",""],["原名","original_name",""],["角色","_character_name","characters"],["作品","_franchise_name","franchises"],["製造商","manufacturer","manufacturers"],["比例","scale","_scale"],["系列","series","series"],["版本","version_name",""],["原型師","sculptor","sculptors"],["塗裝師","painter","painters"],["原畫","illustrator","illustrators"],["素材","material","_material"],["尺寸","dimensions",""],["類型","figure_type","_figure_type"],["性別","gender",""],["年齡分級","age_rating","_age_rating"],["發售日期","release_date",""],["再版日期","reissue_dates",""],["JAN","jan_code",""],["官方頁面","official_url",""],["來源ID","source_id",""]] as [string,string,string][]).map(([label,field,ep])=>{const isAc=!!ep;return(<div key={field} className="relative"><label className="mb-1 block text-[10px] text-[var(--muted)]">{label}</label><input value={editForm[field]??""}onChange={e=>{setEditForm({...editForm,[field]:e.target.value});if(isAc)fetchAc(ep,e.target.value,"fig_"+field);}} onBlur={()=>setTimeout(()=>{if(acField==="fig_"+field){setAcSuggestions([]);setAcField(null);}},200)} className={inp}/>{isAc&&acField==="fig_"+field&&acSuggestions.length>0&&(<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto border border-[var(--rule)] bg-[var(--ground-lift)] shadow-lg">{acSuggestions.map((s,i)=>(<button key={i} onMouseDown={e=>e.preventDefault()} onClick={()=>{setEditForm({...editForm,[field]:s.name});setAcSuggestions([]);setAcField(null);}} className="w-full px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--ground-lift)]">{s.name}</button>))}</div>)}</div>);})}<div><label className="mb-1 block text-[10px] text-[var(--muted)]">定價</label><div className="flex gap-1"><input type="number" value={editForm.retail_price??""} onChange={e=>setEditForm({...editForm,retail_price:e.target.value?Number(e.target.value):null})} className={inp+" rounded-l "}/><button type="button" onClick={()=>setEditForm({...editForm,retail_currency:editForm.retail_currency==="CNY"?"JPY":"CNY"})} className={"shrink-0 rounded-r border px-2 py-1 text-[10px] font-medium "+((editForm.retail_currency==="CNY")?"border-[var(--hue-red)] bg-[var(--hue-red)]/20 text-[var(--hue-red)]":"border-[var(--ink)] bg-[var(--ink)]/20 text-[var(--ink)]")}>{editForm.retail_currency||"JPY"}</button></div></div><div className="col-span-2"><label className="mb-1 block text-[10px] text-[var(--muted)]">圖片URL</label><input value={editForm.image_url??""} onChange={e=>setEditForm({...editForm,image_url:e.target.value})} className={inp}/></div></div><div className="mt-3 flex gap-2"><button onClick={saveFigure} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>setEditingFig(null)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div>{figureNotes.length>0&&(<div id="figure-notes-section" className="mt-4 border-t border-[var(--rule)] pt-3"><div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-medium text-[var(--ink-2)]">{"社群筆記 ("+figureNotes.length+")"}</h4></div><div className="space-y-2">{figureNotes.map(n=>(<div key={n.id} className={" border p-2 text-xs "+(n.report_count>0?"border-[var(--hue-red)]/30 bg-[var(--hue-red)]/5":"border-[var(--rule)] bg-[var(--ground)]")}><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-[var(--ink)]">{n.content}</p>{n.link_url&&<a href={n.link_url} target="_blank" rel="noopener" className="text-[10px] text-[var(--ink)] hover:underline">{n.link_url.length>60?n.link_url.slice(0,60)+"...":n.link_url}</a>}<div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]"><span>{n.created_at?new Date(n.created_at).toLocaleString("zh-TW"):""}</span>{n.report_count>0&&<span className="text-[var(--hue-red)]">{"檢舉 "+n.report_count+" 次"}</span>}</div></div><button onClick={()=>{ if(!editingFig) return; deleteFigureNote(n.id, editingFig.id); }} className={btn+" shrink-0 bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button></div></div>))}</div></div>)}</div>)}
        {figures.length>0&&!directFigView&&selectedFigIds.size>0&&(<div className="flex flex-wrap items-center gap-2 border border-[var(--ink)]/40 bg-[var(--ground-lift)] p-3"><span className="text-sm font-medium text-[var(--ink)]">已選 {selectedFigIds.size} 個</span><select value={batchField} onChange={e=>{setBatchField(e.target.value);setBatchValue("");}} className="border border-[var(--rule)] bg-[var(--ground)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]">{BATCH_FIELDS.map(([label,field])=>(<option key={field} value={field}>{label}</option>))}</select><input value={batchValue} onChange={e=>setBatchValue(e.target.value)} placeholder={batchField==="__franchise__"?"作品名稱（必填）":batchField==="__character__"?"角色名稱（必填）":"新值（留空＝清空該欄位）"} className="min-w-[160px] flex-1 border border-[var(--rule)] bg-[var(--ground)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]"/><button onClick={batchUpdate} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>套用</button><button onClick={()=>setSelectedFigIds(new Set())} className={btn+" border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)]"}>清除選取</button></div>)}
        {figures.length>0&&!directFigView&&(<div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]"><th className="px-3 py-2 text-left"><input type="checkbox" checked={figures.length>0&&selectedFigIds.size===figures.length} onChange={toggleSelAll} className="cursor-pointer accent-[var(--ink)]"/></th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">圖片</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">名稱</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">製造商</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">比例</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{figures.map(f=>(<tr key={f.id} className={"border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)]"+(selectedFigIds.has(f.id)?" bg-[var(--ink)]/5":"")}><td className="px-3 py-2"><input type="checkbox" checked={selectedFigIds.has(f.id)} onChange={()=>toggleFigSel(f.id)} className="cursor-pointer accent-[var(--ink)]"/></td><td className="px-3 py-2 text-xs text-[var(--muted)]">{f.id}</td><td className="px-3 py-2">{f.image_url?<img src={f.image_url} alt="" className="h-10 w-10 border border-[var(--rule)] object-contain"/>:<div className="h-10 w-10 bg-[var(--ground-lift)]"/>}</td><td className="max-w-[250px] truncate px-3 py-2"><a href={`/figures/${f.id}`} className="text-[var(--ink)] hover:text-[var(--ink)]">{f.name}</a></td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{f.manufacturer||"-"}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{f.scale||"-"}</td><td className="px-3 py-2"><div className="flex gap-1"><button onClick={()=>startEditFig(f.id)} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button><button onClick={()=>{setListFigId(String(f.id));searchListings(String(f.id));}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink-2)] hover:text-[var(--ink)]"}>紀錄</button><button onClick={()=>deleteFigure(f.id)} className={btn+" bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button></div></td></tr>))}</tbody></table></div>)}
      </div>)}

      {/* Inline listings section - shows when a figure's 紀錄 button is clicked */}
      {tab==="figures"&&adminListings.length>0&&(<div className="mt-4 space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">公仔 #{listFigId} 的成交紀錄 ({listTotal} 筆)</h3><button onClick={()=>{setAdminListings([]);setListFigId("");}} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">關閉</button></div>{editingList&&(<div className="border border-[var(--ink)]/30 bg-[var(--ground-lift)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">編輯 Listing #{editingList.id}</h3><button onClick={()=>setEditingList(null)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><EF label="標題" field="title" form={listEditForm} setForm={setListEditForm}/><EF label="來源" field="source" form={listEditForm} setForm={setListEditForm}/><EF label="價格" field="price" form={listEditForm} setForm={setListEditForm} type="number"/><EF label="幣別" field="currency" form={listEditForm} setForm={setListEditForm}/><EF label="狀態" field="condition" form={listEditForm} setForm={setListEditForm}/><div><label className="mb-1 block text-[10px] text-[var(--muted)]">成交日期</label><input type="date" value={listEditForm.sold_at ? listEditForm.sold_at.split("T")[0] : ""} onChange={e=>setListEditForm({...listEditForm,sold_at:e.target.value})} className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"/></div></div><div className="mt-3 flex gap-2"><button onClick={saveList} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>setEditingList(null)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div></div>)}<div className="max-h-[400px] overflow-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-[var(--ground-lift)]"><tr className="border-b border-[var(--rule)]"><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">來源</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">標題</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">價格</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">狀態</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">日期</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{adminListings.map(l=>(<tr key={l.id} id={`listing-${l.id}`} className={`border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)] transition-all duration-500 ${highlightListId===l.id?"ring-2 ring-[var(--ink)] bg-[var(--ink)]/10":""}`}><td className="px-3 py-2 text-xs text-[var(--muted)]">{l.id}</td><td className="px-3 py-2 text-xs text-[var(--ink)]">{l.source}</td><td className="max-w-[200px] truncate px-3 py-2 text-xs text-[var(--ink)]">{l.title}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--ink)]">{l.price?.toLocaleString()} {l.currency}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{l.condition||"-"}</td><td className="px-3 py-2 text-[10px] text-[var(--muted)]">{l.sold_at?new Date(l.sold_at).toLocaleDateString("zh-TW"):"-"}</td><td className="px-3 py-2"><div className="flex gap-1"><button onClick={()=>startEditList(l)} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button><button onClick={()=>deleteList(l.id)} className={btn+" bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button></div></td></tr>))}</tbody></table></div></div>)}

      {tab==="franchises"&&(<div className="space-y-4">
        <div className="flex gap-2"><input type="text" placeholder="搜尋作品名稱..." value={franchiseQ} onChange={e=>setFranchiseQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchFranchises(franchiseQ)} className={inp+" flex-1"}/><button onClick={()=>fetchFranchises(franchiseQ)} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>搜尋</button></div>
        {franchises.length>0&&<p className="text-xs text-[var(--muted)]">共 {franchiseTotal} 筆結果（顯示 {franchises.length}）</p>}
        {editingFranchise&&(<div className="border border-[var(--ink)]/30 bg-[var(--ground-lift)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">編輯作品 #{editingFranchise.id}</h3><button onClick={()=>setEditingFranchise(null)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button></div><p className="mb-3 text-xs text-[var(--hue-red)]">⚠ 此變更將影響 {editingFranchise.figure_count.toLocaleString()} 個公仔</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-[10px] text-[var(--muted)]">作品名稱（主名）</label><input value={franchiseForm.name} onChange={e=>setFranchiseForm(f=>({...f,name:e.target.value}))} className={inp}/></div><div><label className="mb-1 block text-[10px] text-[var(--muted)]">中文名稱（可選）</label><input value={franchiseForm.name_zh} onChange={e=>setFranchiseForm(f=>({...f,name_zh:e.target.value}))} className={inp}/></div></div><div className="mt-3 flex gap-2"><button onClick={saveFranchise} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>setEditingFranchise(null)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div></div>)}
        {franchises.length>0&&(<div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]"><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">作品名稱</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">中文名</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">公仔數</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{franchises.map(f=>(<tr key={f.id} className="border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)]"><td className="px-3 py-2 text-xs text-[var(--muted)]">{f.id}</td><td className="px-3 py-2 text-[var(--ink)]">{f.name}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{f.name_zh||"-"}</td><td className="px-3 py-2 text-xs text-[var(--ink)]">{f.figure_count.toLocaleString()}</td><td className="px-3 py-2"><button onClick={()=>{setEditingFranchise(f);setFranchiseForm({name:f.name,name_zh:f.name_zh||""});}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button></td></tr>))}</tbody></table></div>)}
      </div>)}

      {tab==="characters"&&(<div className="space-y-4">
        <div className="flex gap-2"><input type="text" placeholder="搜尋角色名稱..." value={characterQ} onChange={e=>setCharacterQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&fetchCharacters(characterQ)} className={inp+" flex-1"}/><button onClick={()=>fetchCharacters(characterQ)} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>搜尋</button></div>
        {characters.length>0&&<p className="text-xs text-[var(--muted)]">共 {characterTotal} 筆結果（顯示 {characters.length}）</p>}
        {editingCharacter&&(<div className="border border-[var(--ink)]/30 bg-[var(--ground-lift)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">編輯角色 #{editingCharacter.id}</h3><button onClick={()=>setEditingCharacter(null)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button></div><p className="mb-2 text-xs text-[var(--ink-2)]">所屬作品：{editingCharacter.franchise_name||"-"}</p><p className="mb-3 text-xs text-[var(--hue-red)]">⚠ 此變更將影響 {editingCharacter.figure_count.toLocaleString()} 個公仔</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-[10px] text-[var(--muted)]">角色名稱（主名）</label><input value={characterForm.name} onChange={e=>setCharacterForm(f=>({...f,name:e.target.value}))} className={inp}/></div><div><label className="mb-1 block text-[10px] text-[var(--muted)]">中文名稱（可選）</label><input value={characterForm.name_zh} onChange={e=>setCharacterForm(f=>({...f,name_zh:e.target.value}))} className={inp}/></div></div><div className="mt-3 flex gap-2"><button onClick={saveCharacter} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>setEditingCharacter(null)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div></div>)}
        {characters.length>0&&(<div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]"><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">角色名稱</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">中文名</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">作品</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">公仔數</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{characters.map(c=>(<tr key={c.id} className="border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)]"><td className="px-3 py-2 text-xs text-[var(--muted)]">{c.id}</td><td className="px-3 py-2 text-[var(--ink)]">{c.name}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{c.name_zh||"-"}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{c.franchise_name||"-"}</td><td className="px-3 py-2 text-xs text-[var(--ink)]">{c.figure_count.toLocaleString()}</td><td className="px-3 py-2"><button onClick={()=>{setEditingCharacter(c);setCharacterForm({name:c.name,name_zh:c.name_zh||""});}} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button></td></tr>))}</tbody></table></div>)}
      </div>)}

      {tab==="listings"&&(<div className="space-y-4">
        <div className="flex gap-2"><input type="text" placeholder="輸入公仔 ID..." value={listFigId} onChange={e=>setListFigId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchListings(listFigId)} className={inp+" w-48"}/><button onClick={()=>searchListings(listFigId)} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>查詢</button></div>
        {adminListings.length>0&&<p className="text-xs text-[var(--muted)]">共 {listTotal} 筆成交紀錄</p>}
        {editingList&&(<div className="border border-[var(--ink)]/30 bg-[var(--ground-lift)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium text-[var(--ink)]">編輯 Listing #{editingList.id}</h3><button onClick={()=>setEditingList(null)} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">&times;</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><EF label="標題" field="title" form={listEditForm} setForm={setListEditForm}/><EF label="來源" field="source" form={listEditForm} setForm={setListEditForm}/><EF label="價格" field="price" form={listEditForm} setForm={setListEditForm} type="number"/><EF label="幣別" field="currency" form={listEditForm} setForm={setListEditForm}/><EF label="標準化價格" field="price_canonical" form={listEditForm} setForm={setListEditForm} type="number"/><EF label="狀態" field="condition" form={listEditForm} setForm={setListEditForm}/><div><label className="mb-1 block text-[10px] text-[var(--muted)]">成交日期</label><input type="date" value={listEditForm.sold_at ? listEditForm.sold_at.split("T")[0] : ""} onChange={e=>setListEditForm({...listEditForm,sold_at:e.target.value})} className="w-full border border-[var(--rule)] bg-[var(--ground-lift)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"/></div><div className="col-span-2"><EF label="URL" field="url" form={listEditForm} setForm={setListEditForm}/></div></div><div className="mt-3 flex gap-2"><button onClick={saveList} className={btn+" bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button><button onClick={()=>setEditingList(null)} className={btn+" border border-[var(--rule)] text-[var(--ink-2)]"}>取消</button></div></div>)}
        {adminListings.length>0&&(<div className="max-h-[500px] overflow-auto border border-[var(--rule)]"><table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-[var(--ground-lift)]"><tr className="border-b border-[var(--rule)]"><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">來源</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">標題</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">價格</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">換算TWD</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">狀態</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">日期</th><th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th></tr></thead><tbody>{adminListings.map(l=>(<tr key={l.id} id={`listing-${l.id}`} className={`border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)] transition-all duration-500 ${highlightListId===l.id?"ring-2 ring-[var(--ink)] bg-[var(--ink)]/10":""}`}><td className="px-3 py-2 text-xs text-[var(--muted)]">{l.id}</td><td className="px-3 py-2 text-xs text-[var(--ink)]">{l.source}</td><td className="max-w-[200px] truncate px-3 py-2 text-xs text-[var(--ink)]">{l.title}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--ink)]">{l.price?.toLocaleString()} {l.currency}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--ink-2)]">{l.price!=null&&l.currency&&l.currency!=="TWD"?convertPriceToTWD(l.price,l.currency):"-"}</td><td className="px-3 py-2 text-xs text-[var(--ink-2)]">{l.condition||"-"}</td><td className="px-3 py-2 text-[10px] text-[var(--muted)]">{l.sold_at?new Date(l.sold_at).toLocaleDateString("zh-TW"):"-"}</td><td className="px-3 py-2"><div className="flex gap-1"><button onClick={()=>startEditList(l)} className={btn+" bg-[var(--ground-lift)] text-[var(--ink)] hover:bg-[var(--ink)]/20"}>編輯</button><button onClick={()=>deleteList(l.id)} className={btn+" bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button></div></td></tr>))}</tbody></table></div>)}
      </div>)}

      {tab==="users"&&!loading&&(<div className="space-y-4">
        {userMsg && <p className={`text-sm ${userMsg.includes("成功") || userMsg.includes("已刪除") ? "text-green-400" : "text-[var(--hue-red)]"}`}>{userMsg}</p>}
        {/* Create user form */}
        <div className={card}>
          <h3 className="mb-3 text-sm font-medium text-[var(--ink)]">新增帳號</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">帳號</label>
              <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="username" className={inp + " w-40"} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">密碼</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="password" className={inp + " w-40"} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--muted)]">角色</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} className={inp + " w-32"}>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button onClick={createUser} className={btn + " bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>建立</button>
        </div>
        </div>
        {/* User list */}
        {users.length > 0 && (
          <div className="overflow-x-auto border border-[var(--rule)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--ground-lift)]">
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">ID</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">帳號</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">角色</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">建立時間</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ink-2)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-[var(--ground-lift)] hover:bg-[var(--ground-lift)]">
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{u.id}</td>
                    <td className="px-3 py-2 text-[var(--ink)]">{u.username}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
 u.role === "super_admin" ? "bg-[var(--ink)]/20 text-[var(--ink)]" :
 u.role === "admin" ? "bg-blue-900/30 text-blue-400" :
                        "bg-[var(--ground-lift)] text-[var(--ink-2)]"
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-[var(--muted)]">{u.created_at ? new Date(u.created_at).toLocaleString("zh-TW") : "-"}</td>
                    <td className="px-3 py-2">
                      {u.role !== "super_admin" && (
                        <button onClick={() => deleteUser(u.id, u.username)} className={btn + " bg-red-900/30 text-[var(--hue-red)] hover:bg-red-900/50"}>刪除</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>)}

      {tab==="settings"&&!loading&&(<div className="space-y-4">
        {settingsMsg && <p className={`text-sm ${settingsMsg.includes("已儲存") ? "text-green-400" : "text-[var(--hue-red)]"}`}>{settingsMsg}</p>}
        <div className={card}>
          <h3 className="mb-2 text-sm font-medium text-[var(--ink)]">飆股模式標題</h3>
          <p className="mb-2 text-[10px] text-[var(--muted)]">一行一個標題，顯示於 Trending 頁面飆股模式</p>
          <textarea value={settingsBest} onChange={e => setSettingsBest(e.target.value)} rows={5} className={inp} />
          <button onClick={() => saveConfig("trending_best_titles", settingsBest)} className={btn + " mt-2 bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button>
        </div>
        <div className={card}>
          <h3 className="mb-2 text-sm font-medium text-[var(--ink)]">砸盤模式標題</h3>
          <p className="mb-2 text-[10px] text-[var(--muted)]">一行一個標題，顯示於 Trending 頁面砸盤模式</p>
          <textarea value={settingsWorst} onChange={e => setSettingsWorst(e.target.value)} rows={5} className={inp} />
          <button onClick={() => saveConfig("trending_worst_titles", settingsWorst)} className={btn + " mt-2 bg-[var(--ink)] text-[var(--ground)] hover:bg-[var(--ink-2)]"}>儲存</button>
        </div>
      </div>)}
    </div>
  );
}
