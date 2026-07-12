import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Play, Image as ImageIcon, Settings, Bug, Link2, Upload, Copy, ClipboardPaste, Eraser, Check, Download, RefreshCw, Trash2, Star, ScrollText, Code2, ChevronRight } from 'lucide-react';
import { ColumnInfo } from '../services/AgentContext';
import AgentLogViewer from './AgentLogViewer';
import AgentPromptEditor from './AgentPromptEditor';

/** 生产环境默认 API Key（开箱即用） */
const DEFAULT_KEYS = {
  playground: 'sk-rJgT1iHbleI6m1RKgjTWHkFJDNhpJvKIwYK6rYcOPSx1qw7o',
  agent: 'sk-ws-H.EMMIXMX.oCgV.MEQCIFIc_XDd7V2wSDZsJBXrdAJFO7D7SJb3obOqT_PXF3FFAiABCmWqIJVE0nCX339hCPFbVxu1aZ6R_pXUnGf68Ut3_w',
  bocha: 'sk-2d0a9209935b4cafbb6c9af3a6f70625',
};
const isProd = import.meta.env.PROD;

interface ResultItem {
  id: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  prompt: string;
  refImages: string[];
  timestamp: number;
  duration: number;
  imageUrl?: string;
  errorMessage?: string;
}

interface ColumnConfig {
  id: string;
  name: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  prompt: string;
  refImages: string[];
  isGenerating: boolean;
  generatingPrompt?: string;
  resultUrl: string | null;
  results: ResultItem[];
  logs: string[];
  downloaded: Set<string>;
  selected: Set<string>;
}

const MODEL_OPTIONS = [
  { value: 'gpt-image-2-2in1', label: 'gpt-image-2-2in1' },
  { value: 'gpt-image-2', label: 'gpt-image-2' },
  { value: 'gpt-image-2-all', label: 'gpt-image-2-all' },
  { value: 'nano-banana-2', label: 'nano-banana-2' },
  { value: 'nano-banana-pro', label: 'nano-banana-pro' },
  { value: 'nano-banana-hd', label: 'nano-banana-hd' },
  { value: 'nano-banana-pro-2k', label: 'nano-banana-pro-2k' },
];

const ASPECT_OPTIONS = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '21:9', label: '21:9' },
];

const RESOLUTION_OPTIONS = [
  { value: '1k', label: '1k' },
  { value: '2k', label: '2k' },
  { value: '4k', label: '4k' },
];

const QUALITY_OPTIONS = [
  { value: 'auto', label: 'auto' },
  { value: 'high', label: 'high' },
  { value: 'hd', label: 'hd' },
  { value: 'standard', label: 'standard' },
  { value: 'medium', label: 'medium' },
  { value: 'low', label: 'low' },
];

const PRESET_IMAGES = [
  '/assets/睡衣加发丝光.png',
  '/assets/睡衣金瞳.png',
];

const ASPECT_PREVIEW_RATIO: Record<string, number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '3:2': 3 / 2,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '21:9': 21 / 9,
};

/* ───────────── 滚动位置持久化 ───────────── */
// useProjectId 需要在组件内动态获取，这里用参数形式
interface ScrollPositions {
  h: number;  // horizontal scrollLeft
  v: Record<string, number>;  // columnId → scrollTop
}
function loadScrollPositions(projectId: string): ScrollPositions {
  try {
    const key = getScrollKey(projectId);
    const raw = localStorage.getItem(key);
    const result = raw ? JSON.parse(raw) : { h: 0, v: {} };
    return result;
  } catch (e) {
    return { h: 0, v: {} };
  }
}
function saveScrollPositions(projectId: string, pos: ScrollPositions) {
  try { 
    const key = getScrollKey(projectId);
    localStorage.setItem(key, JSON.stringify(pos));
  } catch (e) { 
  }
}

/* ───────────── 项目管理 ───────────── */
const PROJECTS_KEY = 'gptimage_projects_v1';
const CURRENT_PROJECT_KEY = 'gptimage_current_project';

interface Project {
  id: string;
  name: string;
  createdAt: number;
}

function getColumnsKey(projectId: string): string {
  return `gptimage2_columns_v2_${projectId}`;
}
function getScrollKey(projectId: string): string {
  return `gptimage2_scroll_v2_${projectId}`;
}
function loadProjects(): Project[] {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); }
  catch { return []; }
}
function saveProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}
function loadCurrentProjectId(): string {
  return localStorage.getItem(CURRENT_PROJECT_KEY) || '';
}
function saveCurrentProjectId(id: string): void {
  localStorage.setItem(CURRENT_PROJECT_KEY, id);
}
function ensureDefaultProject(): { projects: Project[]; currentId: string } {
  let projects = loadProjects();
  let currentId = loadCurrentProjectId();
  if (projects.length === 0) {
    const def: Project = { id: 'default', name: '默认项目', createdAt: Date.now() };
    projects = [def];
    currentId = 'default';
    saveProjects(projects);
    saveCurrentProjectId(currentId);
  } else if (!currentId || !projects.find(p => p.id === currentId)) {
    currentId = projects[0].id;
    saveCurrentProjectId(currentId);
  }
  return { projects, currentId };
}

// 从旧版 Storage Key 迁移到当前项目命名空间
function migrateFromOldStorage(): boolean {
  const oldKey = 'gptimage2_columns_v2';
  const newKey = getColumnsKey(loadCurrentProjectId());
  if (newKey === oldKey) return false; // 偶发相同，无需迁移
  try {
    const data = localStorage.getItem(oldKey);
    if (data) {
      localStorage.setItem(newKey, data);
      localStorage.removeItem(oldKey);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
// 迁移旧滚动位置
function migrateOldScroll(): boolean {
  const oldKey = 'gptimage2_scroll_v2';
  const newKey = getScrollKey(loadCurrentProjectId());
  if (newKey === oldKey) return false;
  try {
    const data = localStorage.getItem(oldKey);
    if (data) {
      localStorage.setItem(newKey, data);
      localStorage.removeItem(oldKey);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function createEmptyColumn(index: number): ColumnConfig {
  return {
    id: `col_${Date.now()}_${index}`,
    name: `生图列_${String(index + 1).padStart(2, '0')}`,
    model: 'gpt-image-2-2in1',
    aspectRatio: '9:16',
    resolution: '1k',
    quality: 'auto',
    prompt: '',
    refImages: [],
    isGenerating: false,
    resultUrl: null,
    results: [],
    logs: [],
    downloaded: new Set(),
    selected: new Set(),
  };
}

/* ───────────── 持久化：localStorage + IndexedDB ───────────── */

const DB_NAME = 'IMAGINE_DB';
const DB_VERSION = 4;
const STORE_NAME = 'columns';
const IMAGES_STORE = 'images';
const REF_IMAGES_STORE = 'ref_images';
const GALLERY_STORE = 'gallery';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REF_IMAGES_STORE)) {
        db.createObjectStore(REF_IMAGES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(GALLERY_STORE)) {
        db.createObjectStore(GALLERY_STORE, { keyPath: 'id' });
      }
    };
  });
}

const STORAGE_KEY = 'gptimage2_columns_v2';

async function loadGalleryFromDB(): Promise<{ url: string; name: string; origin?: string }[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(GALLERY_STORE, 'readonly');
    const store = tx.objectStore(GALLERY_STORE);
    const all = await new Promise<{ id: string; url: string; name: string; origin?: string }[]>((resolve, reject) => {
      const req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return all.map(item => ({ url: item.url, name: item.name, origin: item.origin }));
  } catch { return []; }
}

async function saveGalleryToDB(items: { url: string; name: string; origin?: string }[]) {
  try {
    const db = await openDB();
    const tx = db.transaction(GALLERY_STORE, 'readwrite');
    const store = tx.objectStore(GALLERY_STORE);
    // 清空旧数据
    await new Promise<void>((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => resolve();
    });
    // 写入新数据
    for (let i = 0; i < items.length; i++) {
      store.put({ id: `gallery_${i}`, url: items[i].url, name: items[i].name, origin: items[i].origin });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* ignore */ }
}

/** 将 HTTP URL 转成 data URL（通过服务端代理绕过 CORS，用于持久化避免盗链问题） */
async function httpUrlToDataUrl(url: string): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
  try {
    const params = new URLSearchParams({ url });
    // 传递浏览器 Referer 和 User-Agent，绕过 CDN 防盗链
    params.set('referer', window.location.origin);
    params.set('ua', navigator.userAgent);
    const res = await fetch(`/api/proxy-image?${params}`);
    if (!res.ok) return url;
    const rawBlob = await res.blob();
    // 空 body 或极小 body 大概率是 CDN 拦截页，放弃保存用原 URL
    if (rawBlob.size < 256) return url;
    // 强制图片 MIME 类型：CDN 常返回非标准 Content-Type（如 octet-stream），
    // 但数据本身是图片，直接用 FileReader 转 data URL 显示
    const imageBlob = rawBlob.type.startsWith('image/')
      ? rawBlob
      : new Blob([rawBlob], { type: 'image/png' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.onabort = () => reject(new Error('FileReader aborted'));
      reader.readAsDataURL(imageBlob);
    });
  } catch { return url; }
}

async function saveRefImageBlob(dataUrl: string): Promise<string> {
  const imageId = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const db = await openDB();
    const tx = db.transaction(REF_IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(REF_IMAGES_STORE);
    store.put({ id: imageId, blob });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return imageId;
  } catch {
    return '';
  }
}

async function loadRefImageBlobUrl(imageId: string): Promise<string | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(REF_IMAGES_STORE, 'readonly');
    const store = tx.objectStore(REF_IMAGES_STORE);
    const record = await new Promise<{ id: string; blob: Blob } | undefined>((resolve, reject) => {
      const req = store.get(imageId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (record && record.blob) {
      return URL.createObjectURL(record.blob);
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveColumnsToStorage(columns: ColumnConfig[]): Promise<void> {
  try {
    const serialized = await Promise.all(columns.map(async col => {
      const colRefImageIds = await Promise.all(col.refImages.map(img => saveRefImageBlob(img)));
      const results = await Promise.all(col.results.map(async r => {
        const itemRefImageIds = await Promise.all(r.refImages.map(img => saveRefImageBlob(img)));
        return {
          ...r,
          refImages: itemRefImageIds,
        };
      }));
      return {
        ...col,
        refImages: colRefImageIds,
        results,
        downloaded: Array.from(col.downloaded),
        selected: Array.from(col.selected),
      };
    }));
    localStorage.setItem(getColumnsKey(loadCurrentProjectId()), JSON.stringify(serialized));
  } catch {
    // 忽略存储失败（如隐私模式）
  }
}

async function loadColumnsFromStorage(): Promise<ColumnConfig[] | null> {
  try {
    const data = localStorage.getItem(getColumnsKey(loadCurrentProjectId()));
    if (data) {
      const parsed = JSON.parse(data);
      return await Promise.all(parsed.map(async (col: any) => {
        const colRefImages = await Promise.all((col.refImages || []).map(async (imgId: string) => {
          if (imgId.startsWith('ref_')) {
            const url = await loadRefImageBlobUrl(imgId);
            return url || '';
          }
          return imgId;
        }));
        const oldResults = col.results || [];
        const results: ResultItem[] = await Promise.all(oldResults.map(async (r: any) => {
          // 新格式：r 已是 ResultItem 对象，直接保留（imageUrl/errorMessage/model 等快照值都在）
          if (typeof r === 'object' && r !== null) {
            const itemRefImages = await Promise.all((r.refImages || []).map(async (imgId: string) => {
              if (imgId.startsWith('ref_')) {
                const url = await loadRefImageBlobUrl(imgId);
                return url || '';
              }
              return imgId;
            }));
            return { ...r, refImages: itemRefImages } as ResultItem;
          }
          // 旧格式：r 是 id 字符串，从映射字段转换（向后兼容）
          const id = r as string;
          return {
            id,
            model: col.resultModels?.[id] || col.model || '',
            aspectRatio: col.resultAspectRatios?.[id] || col.aspectRatio || '',
            resolution: col.resultResolutions?.[id] || col.resolution || '',
            prompt: col.resultPrompts?.[id] || col.prompt || '',
            refImages: [],
            timestamp: col.resultTimestamps?.[id] || 0,
            duration: col.resultDurations?.[id] || 0,
            imageUrl: col.imageUrls?.[id],
            errorMessage: col.errorMessages?.[id],
          };
        }));
        return {
          ...col,
          refImages: colRefImages.filter(Boolean),
          results,
          downloaded: col.downloaded ? new Set(col.downloaded) : new Set(),
          selected: col.selected ? new Set(col.selected) : new Set(),
          logs: [],
        };
      }));
    }
    return null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────── */

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 下载图片为 Blob 并存入 images store，返回 imageId。
 *  可传入 presetId 用于复用既有 id（如 pending item）；若不传则内部生成。
 *  传 presetId 时，失败会抛错（由外层 catch 统一转成错误卡片）；
 *  不传时保持旧行为（失败返回 err_ id）。 */
async function saveImageBlob(url: string, presetId?: string): Promise<string> {
  const imageId = presetId || `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const db = await openDB();
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(IMAGES_STORE);
    store.put({ id: imageId, blob });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return imageId;
  } catch (e) {
    if (presetId) throw e; // 传了 presetId 就抛错，由外层 catch 处理
    return `err_${Date.now()}`;
  }
}

/** 从 images store 读取 Blob 并创建 objectURL 的 Map */
async function loadImageBlobUrls(ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return map;
  try {
    const db = await openDB();
    const tx = db.transaction(IMAGES_STORE, 'readonly');
    const store = tx.objectStore(IMAGES_STORE);
    for (const id of ids) {
      try {
        const record = await new Promise<{ id: string; blob: Blob } | undefined>((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (record && record.blob) {
          map[id] = URL.createObjectURL(record.blob);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map;
}

/** 删除 images store 中不再使用的图片 */
async function deleteImageBlobs(ids: string[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(IMAGES_STORE);
    for (const id of ids) store.delete(id);
    await new Promise<void>(r => { tx.oncomplete = () => r(); });
  } catch { /* skip */ }
}

function getNextColumnNumber(cols: ColumnConfig[]): number {
  let max = 0;
  for (const c of cols) {
    const m = c.name.match(/生图列_(\d+)/);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return max + 1;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function GenerationColumns({ onOpenSandbox, agentActionsRef }: {
  onOpenSandbox: () => void;
  agentActionsRef: React.MutableRefObject<{
    addColumn: () => void;
    removeColumn: (id: string) => void;
    updateColumn: (id: string, patch: Record<string, unknown>) => void;
    getColumns: () => ColumnInfo[];
    generateImage: (id: string) => void;
    deleteImage: (colId: string, imageIndex: number) => void;
    toggleFavorite: (colId: string, imageIndex: number) => void;
  }>;
}) {
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const columnsRef = useRef<ColumnConfig[]>([]);
  // 每个生成任务的 AbortController，key = pendingId，用于中断生成
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState(() => {
    const stored = localStorage.getItem('Playground_apiKey');
    if (stored) return stored;
    if (isProd) { localStorage.setItem('Playground_apiKey', DEFAULT_KEYS.playground); return DEFAULT_KEYS.playground; }
    return '';
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Toast 自动消失
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // ──── 项目管理 ────
  const [projects, setProjects] = useState<Project[]>(() => ensureDefaultProject().projects);
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => ensureDefaultProject().currentId);
  const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [storageUsage, setStorageUsage] = useState<{ used: number; total: number; percent: number }>({ used: 0, total: 0, percent: 0 });
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [showAgentLog, setShowAgentLog] = useState(false);
  const [showAgentPromptEditor, setShowAgentPromptEditor] = useState(false);
  const [agentApiKey, setAgentApiKey] = useState(() => {
    const stored = localStorage.getItem('agent_qwen_api_key');
    if (stored) return stored;
    if (isProd) { localStorage.setItem('agent_qwen_api_key', DEFAULT_KEYS.agent); return DEFAULT_KEYS.agent; }
    return '';
  });
  const [bochaApiKey, setBochaApiKey] = useState(() => {
    const stored = localStorage.getItem('bocha_api_key');
    if (stored) return stored;
    if (isProd) { localStorage.setItem('bocha_api_key', DEFAULT_KEYS.bocha); return DEFAULT_KEYS.bocha; }
    return '';
  });
  const [pageReady, setPageReady] = useState(false);
  const [referenceGallery, setReferenceGallery] = useState<{ url: string; name: string; origin?: string }[]>([]);
  const galleryRef = useRef(referenceGallery);
  galleryRef.current = referenceGallery;
  const galleryLoadedRef = useRef(false);
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [showGalleryInput, setShowGalleryInput] = useState(false);
  const [galleryInputUrl, setGalleryInputUrl] = useState('');
  const [isDraggingToGallery, setIsDraggingToGallery] = useState(false);
  const [refPreview, setRefPreview] = useState<{ colId: string; url: string } | null>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const columnScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollPositions, setScrollPositions] = useState<ScrollPositions>(() => {
    const { currentId } = ensureDefaultProject();
    return loadScrollPositions(currentId);
  });
  const scrollPosRef = useRef<ScrollPositions>(scrollPositions);
  scrollPosRef.current = scrollPositions;

  const registerColumnScrollRef = useCallback((colId: string, ref: HTMLDivElement | null) => {
    columnScrollRefs.current[colId] = ref;
    console.log(`[${Date.now()}] Column scroll ref registered: ${colId}, scrollTop=${ref?.scrollTop}`);
  }, []);

  // 暂存区持久化（IndexedDB），初始加载完成前不保存
  useEffect(() => {
    if (!galleryLoadedRef.current) return;
    saveGalleryToDB(referenceGallery);
  }, [referenceGallery]);

  // 页面加载时从 IndexedDB 读取暂存区
  useEffect(() => {
    loadGalleryFromDB().then(items => {
      if (items.length > 0) setReferenceGallery(items);
      galleryLoadedRef.current = true;
    });
  }, []);

  // 水平滚动位置保存（节流）
  const handleHorizontalScroll = useCallback(() => {
    const el = horizontalScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const scrollLeft = el.scrollLeft;
      const pos = { ...scrollPosRef.current, h: scrollLeft };
      scrollPosRef.current = pos;
      setScrollPositions(pos);
      saveScrollPositions(currentProjectId, pos);
    });
  }, [currentProjectId]);

  // 列垂直滚动位置保存（节流）
  const handleColumnScroll = useCallback((colId: string, scrollTop: number) => {
    requestAnimationFrame(() => {
      const pos = { ...scrollPosRef.current, v: { ...scrollPosRef.current.v, [colId]: scrollTop } };
      scrollPosRef.current = pos;
      setScrollPositions(pos);
      saveScrollPositions(currentProjectId, pos);
    });
  }, [currentProjectId]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const h = horizontalScrollRef.current?.scrollLeft || 0;
      const pos = { ...scrollPosRef.current, h };
      saveScrollPositions(currentProjectId, pos);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ──── 项目管理：关闭菜单 ────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
        setEditingProjectId(null);
      }
    };
    if (projectMenuOpen) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [projectMenuOpen]);

  const initializeProject = async () => {
    setLoaded(false);
    columnScrollRefs.current = {};
    try {
      const saved = await loadColumnsFromStorage();
      if (saved && saved.length > 0) {
        setColumns(saved);
        columnsRef.current = saved;
        const blobIds = saved.flatMap(c =>
          c.results.filter(r => r.imageUrl).map(r => r.id)
        );
        if (blobIds.length > 0) {
          const urls = await loadImageBlobUrls(blobIds);
          const missingIds: string[] = [];
          for (const id of blobIds) {
            if (!urls[id]) missingIds.push(id);
          }
          if (missingIds.length > 0) {
            for (const id of missingIds) {
              for (const col of saved) {
                const item = col.results.find(r => r.id === id);
                if (item && item.imageUrl) {
                  try {
                    const res = await fetch(item.imageUrl);
                    const blob = await res.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    urls[id] = objectUrl;
                  } catch { /* skip */ }
                }
              }
            }
          }
          setImageUrls(urls);
        }
        const pendingCols = saved.filter(c => c.isGenerating);
        if (pendingCols.length > 0) {
          setTimeout(() => {
            pendingCols.forEach(c => generate(c));
          }, 100);
        }
      } else {
        const initial = [createEmptyColumn(0), createEmptyColumn(1)];
        setColumns(initial);
        columnsRef.current = initial;
      }
    } catch {
      const initial = [createEmptyColumn(0), createEmptyColumn(1)];
      setColumns(initial);
      columnsRef.current = initial;
    }
    const sp = loadScrollPositions(currentProjectId);
    setScrollPositions(sp);
    setLoaded(true);
  };

  const switchProject = async (newId: string) => {
    await saveColumnsToStorage(columnsRef.current);
    saveScrollPositions(currentProjectId, scrollPosRef.current);
    saveCurrentProjectId(newId);
    window.location.reload();
  };

  const createProject = () => {
    setNewProjectName('');
    setShowNewProjectModal(true);
  };

  const confirmCreateProject = () => {
    const name = newProjectName;
    if (!name?.trim()) return;
    // 保存当前项目状态
    saveColumnsToStorage(columnsRef.current).catch(() => {});
    saveScrollPositions(currentProjectId, scrollPosRef.current);
    // 显示加载遮罩
    setPageReady(false);

    const newProject: Project = { id: `proj_${Date.now()}`, name: name.trim(), createdAt: Date.now() };
    const updated = [...projects, newProject];
    setProjects(updated);
    saveProjects(updated);
    // 自动切换到新项目
    setCurrentProjectId(newProject.id);
    saveCurrentProjectId(newProject.id);
    // 新项目默认两列生图列
    const defaultCols = [createEmptyColumn(0), createEmptyColumn(1)];
    setColumns(defaultCols);
    columnsRef.current = defaultCols;
    setImageUrls({});
    setProjectMenuOpen(false);
    setShowNewProjectModal(false);
    setNewProjectName('');
    // 延迟一帧后设置水平滚动使两列居中
    requestAnimationFrame(() => {
      const container = horizontalScrollRef.current;
      if (container) {
        const contentWidth = container.scrollWidth;
        const containerWidth = container.clientWidth;
        const scrollTo = (contentWidth - containerWidth) / 2;
        container.scrollLeft = Math.max(0, scrollTo);
      }
      setPageReady(true);
    });
  };

  const renameProject = (id: string, newName: string) => {
    if (!newName.trim()) return;
    const updated = projects.map(p => p.id === id ? { ...p, name: newName.trim() } : p);
    setProjects(updated);
    saveProjects(updated);
    setEditingProjectId(null);
  };

  const deleteProject = (id: string) => {
    if (projects.length <= 1) {
      setToastMsg('至少保留一个项目');
      return;
    }
    setPendingDeleteProjectId(id);
    setProjectMenuOpen(false);
  };

  const confirmDeleteProject = () => {
    const id = pendingDeleteProjectId;
    if (!id) return;
    const updated = projects.filter(p => p.id !== id);
    if (updated.length === 0) return;
    setProjects(updated);
    saveProjects(updated);
    localStorage.removeItem(getColumnsKey(id));
    localStorage.removeItem(getScrollKey(id));
    if (id === currentProjectId) {
      const nextId = updated[0].id;
      setCurrentProjectId(nextId);
      saveCurrentProjectId(nextId);
      loadColumnsFromStorage().then(saved => {
        if (saved) { setColumns(saved); columnsRef.current = saved; }
        else { setColumns([]); columnsRef.current = []; }
      });
    }
    setPendingDeleteProjectId(null);
  };

  const cancelDeleteProject = () => {
    setPendingDeleteProjectId(null);
  };

  // 恢复水平滚动位置，完成后标记页面就绪
  useEffect(() => {
    if (!loaded) return;

    // 填充 agent actions ref
    agentActionsRef.current = {
      addColumn: addColumnAtEnd,
      removeColumn: (id: string) => removeColumn(id),
      updateColumn: (id: string, patch: Record<string, unknown>) => updateColumn(id, patch),
      getColumns: () => columnsRef.current.map(c => ({
        id: c.id,
        name: c.name,
        model: c.model,
        aspectRatio: c.aspectRatio,
        resolution: c.resolution,
        quality: c.quality,
        prompt: c.prompt,
        refImages: c.refImages,
        isGenerating: c.isGenerating,
        resultCount: c.results.length,
        selected: Array.from(c.selected),
        results: c.results.map(r => ({
          id: r.id,
          prompt: r.prompt,
          model: r.model,
          aspectRatio: r.aspectRatio,
          resolution: r.resolution,
          quality: r.quality,
          imageUrl: r.imageUrl,
          errorMessage: r.errorMessage,
          favorited: c.selected.has(r.id),
          downloaded: c.downloaded.has(r.id),
          refImages: r.refImages || [],
        })),
      })),
      generateImage: (id: string) => {
        const col = columnsRef.current.find(c => c.id === id);
        if (col) generate(col);
      },
      deleteImage: (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (col && imageIndex >= 0 && imageIndex < col.results.length) {
          updateColumn(colId, {
            results: col.results.filter((_, i) => i !== imageIndex),
          });
        }
      },
      toggleFavorite: (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (col && imageIndex >= 0 && imageIndex < col.results.length) {
          const imgId = col.results[imageIndex].id;
          const newSelected = new Set(col.selected);
          if (newSelected.has(imgId)) newSelected.delete(imgId);
          else newSelected.add(imgId);
          updateColumn(colId, { selected: newSelected });
        }
      },
      abortGenerate: (colId: string) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (!col) return;
        for (const item of col.results) {
          if (!item.imageUrl && !item.errorMessage) {
            abortControllersRef.current.get(item.id)?.abort();
            abortControllersRef.current.delete(item.id);
          }
        }
        updateColumn(colId, {
          isGenerating: false,
          results: col.results.filter(r => r.imageUrl || r.errorMessage),
        });
      },
      addRefImage: async (colId: string, url: string) => {
        if (!url.trim()) return '无效 URL';
        try {
          const res = await fetch(url);
          if (!res.ok) return `HTTP ${res.status}`;
          const blob = await res.blob();
          if (!blob.type.startsWith('image/')) return '非图片格式';
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const col = columnsRef.current.find(c => c.id === colId);
          if (col) {
            updateColumn(colId, { refImages: [...col.refImages, dataUrl].slice(0, 16) });
          }
          return '已添加参考图';
        } catch {
          return '添加失败';
        }
      },
      addToGallery: async (url: string, name?: string, origin?: string) => {
        const finalUrl = await httpUrlToDataUrl(url);
        setReferenceGallery(prev => {
          if (prev.some(item => item.url === finalUrl)) return prev;
          const next = [...prev, { url: finalUrl, name: name || `参考图 ${prev.length + 1}`, origin }];
          return next;
        });
      },
      clearGallery: () => {
        setReferenceGallery([]);
      },
      // 用户手动添加图片到暂存区
      addImageToGallery: (url: string) => addImageToGallery(url),
      getGalleryImages: () => galleryRef.current,
      addGalleryRef: async (galleryIndex: number, columnIndex: number) => {
        const cols = columnsRef.current;
        const gallery = galleryRef.current;
        if (galleryIndex < 0 || galleryIndex >= gallery.length) return `暂存区索引 ${galleryIndex} 无效`;
        if (columnIndex < 0 || columnIndex >= cols.length) return `列索引 ${columnIndex} 无效`;
        const imgUrl = gallery[galleryIndex].url;
        try {
          const fetchUrl = imgUrl.startsWith('data:')
            ? imgUrl
            : `/api/proxy-image?url=${encodeURIComponent(imgUrl)}&referer=${encodeURIComponent(window.location.origin)}&ua=${encodeURIComponent(navigator.userAgent)}`;
          const res = await fetch(fetchUrl);
          const blob = await res.blob();
          if (!blob.type.startsWith('image/')) return '非图片格式';
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve) => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
          const col = cols[columnIndex];
          const colRef = columnsRef.current.find(c => c.id === col.id);
          if (colRef) {
            updateColumn(col.id, { refImages: [...colRef.refImages, dataUrl].slice(0, 16) });
          }
          return `已将暂存区第 ${galleryIndex + 1} 张图添加到第 ${columnIndex + 1} 列`;
        } catch {
          return '添加失败';
        }
      },
      removeRefImage: (colId: string, index: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (col && index >= 0 && index < col.refImages.length) {
          updateColumn(colId, { refImages: col.refImages.filter((_, i) => i !== index) });
        }
      },
      loadPresetRefImages: async (colId: string) => {
        const presetUrls = ['/assets/睡衣加发丝光.png', '/assets/睡衣金瞳.png'];
        let added = 0;
        for (const url of presetUrls) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            const col = columnsRef.current.find(c => c.id === colId);
            if (col) {
              updateColumn(colId, { refImages: [...(columnsRef.current.find(c => c.id === colId)?.refImages || []), dataUrl].slice(0, 16) });
              added++;
            }
          } catch { /* skip */ }
        }
        return `已加载 ${added} 张预设参考图`;
      },
      useResultAsRef: async (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (!col || imageIndex < 0 || imageIndex >= col.results.length) return '无效图片索引';
        const item = col.results[imageIndex];
        const imageUrl = item.imageUrl;
        if (!imageUrl) return '图片尚未生成完成';
        try {
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          updateColumn(colId, { refImages: [...col.refImages, dataUrl].slice(0, 16) });
          return '已添加为参考图';
        } catch {
          updateColumn(colId, { refImages: [...col.refImages, imageUrl].slice(0, 16) });
          return '已添加为参考图';
        }
      },
      downloadImage: (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (!col || imageIndex < 0 || imageIndex >= col.results.length) return;
        const item = col.results[imageIndex];
        const imageUrl = item.imageUrl;
        if (!imageUrl) return;
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = `generated_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        const newDownloaded = new Set(col.downloaded);
        newDownloaded.add(item.id);
        updateColumn(colId, { downloaded: newDownloaded });
      },
      retryImage: (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (!col || imageIndex < 0 || imageIndex >= col.results.length) return;
        const item = col.results[imageIndex];
        updateColumn(colId, {
          model: item.model || col.model,
          aspectRatio: item.aspectRatio || col.aspectRatio,
          resolution: item.resolution || col.resolution,
          prompt: item.prompt || col.prompt,
        });
        const updatedCol = columnsRef.current.find(c => c.id === colId);
        if (updatedCol) generate(updatedCol);
      },
      clearErrorCards: (colId: string) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (col) {
          updateColumn(colId, { results: col.results.filter(r => !r.errorMessage) });
        }
      },
      clearColumnConfig: (colId: string) => {
        updateColumn(colId, { prompt: '', refImages: [] });
      },
      applyCardConfig: (colId: string, imageIndex: number) => {
        const col = columnsRef.current.find(c => c.id === colId);
        if (!col || imageIndex < 0 || imageIndex >= col.results.length) return;
        const item = col.results[imageIndex];
        updateColumn(colId, {
          model: item.model || col.model,
          aspectRatio: item.aspectRatio || col.aspectRatio,
          resolution: item.resolution || col.resolution,
          prompt: item.prompt || col.prompt,
          refImages: item.refImages?.length ? item.refImages : col.refImages,
        });
      },
      createColumnAtStart: addColumnAtStart,
      createColumnAt: (afterIndex: number) => addColumnBetween(afterIndex),
    };

    const doRestore = () => {
      const container = horizontalScrollRef.current;
      if (container && scrollPositions.h > 0) {
        container.scrollLeft = scrollPositions.h;
      }
      requestAnimationFrame(() => {
        for (const [colId, scrollTop] of Object.entries(scrollPositions.v)) {
          if (scrollTop > 0) {
            const scrollContainer = columnScrollRefs.current[colId];
            if (scrollContainer) {
              scrollContainer.scrollTop = scrollTop;
            }
          }
        }
        requestAnimationFrame(() => {
          setPageReady(true);
        });
      });
    };
    requestAnimationFrame(doRestore);
  }, [loaded]);

  // 同步 ref，供 generate 回调实时访问
   const setColumnsWithRef = useCallback((val: ColumnConfig[] | ((prev: ColumnConfig[]) => ColumnConfig[])) => {
      setColumns(prev => {
         const next = typeof val === 'function' ? (val as (prev: ColumnConfig[]) => ColumnConfig[])(prev) : val;
       columnsRef.current = next;
       return next;
     });
   }, []);

  useEffect(() => {
    migrateFromOldStorage();
    migrateOldScroll();
    initializeProject();
  }, []);

  // 使用 localStorage 自动保存（debounce 防抖，避免频繁写入）
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      saveColumnsToStorage(columns).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [columns, loaded]);

  // API 状态检测
  useEffect(() => {
    if (!apiKey) {
      setApiStatus('offline');
      return;
    }
    setApiStatus('checking');
    fetch('/api/t8star/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    })
      .then(res => setApiStatus(res.ok ? 'online' : 'offline'))
      .catch(() => setApiStatus('offline'));
  }, [apiKey, loaded]);

  // 存储占比计算
  useEffect(() => {
    (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction(IMAGES_STORE, 'readonly');
        const store = tx.objectStore(IMAGES_STORE);
        const allRecords = await new Promise<any[]>((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        const usedBytes = allRecords.reduce((acc, rec) => acc + (rec.blob?.size || 0), 0);

        let totalBytes = 50 * 1024 * 1024;
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          if (estimate.quota) {
            totalBytes = estimate.quota;
          }
        }

        const percent = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
        setStorageUsage({ used: usedBytes, total: totalBytes, percent });
      } catch {
        setStorageUsage({ used: 0, total: 50 * 1024 * 1024, percent: 0 });
      }
    })();
  }, [columns]);

  useEffect(() => {
    const now = Date.now();
    const pendingItems: Record<string, number> = {};
    for (const col of columns) {
      for (const item of col.results) {
        if (!item.imageUrl && !item.errorMessage && item.timestamp > 0) {
          pendingItems[item.id] = Math.floor((now - item.timestamp) / 1000);
        }
      }
    }
    const pendingCount = Object.keys(pendingItems).length;
    if (pendingCount > 0) {
      setTimers(pendingItems);
      const interval = setInterval(() => {
        setTimers(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            next[key]++;
          }
          return next;
        });
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setTimers({});
    }
  }, [columns]);

  const updateColumn = useCallback((id: string, patch: Partial<ColumnConfig> | ((prev: ColumnConfig) => Partial<ColumnConfig>)) => {
    setColumns(prev => {
      const next = prev.map(c => {
        if (c.id !== id) return c;
        const patchObj = typeof patch === 'function' ? patch(c) : patch;
        return { ...c, ...patchObj };
      });
      columnsRef.current = next;
      return next;
    });
  }, []);

  const addColumnAtEnd = useCallback(() => {
    setColumns(prev => {
      const num = getNextColumnNumber(prev);
      const newCol = createEmptyColumn(num - 1);
      newCol.name = `生图列_${String(num).padStart(2, '0')}`;
      const next = [...prev, newCol];
      columnsRef.current = next;
      return next;
    });
  }, []);

  const addColumnAtStart = useCallback(() => {
    setColumns(prev => {
      const num = getNextColumnNumber(prev);
      const newCol = createEmptyColumn(0);
      newCol.name = `生图列_${String(num).padStart(2, '0')}`;
      return [newCol, ...prev];
    });
  }, []);

  const addColumnBetween = useCallback((afterIndex: number) => {
    setColumns(prev => {
      const num = getNextColumnNumber(prev);
      const newCol = createEmptyColumn(0);
      newCol.name = `生图列_${String(num).padStart(2, '0')}`;
      const next = [...prev];
      next.splice(afterIndex + 1, 0, newCol);
      return next;
    });
  }, []);

  const removeColumn = useCallback((id: string) => {
    // 先在当前 columnsRef 上做清理（避免在 setColumns updater 内嵌套调用 setState）
    const col = columnsRef.current.find(c => c.id === id);
    if (col) {
      const blobIds = col.results.filter(r => r.imageUrl).map(r => r.id);
      if (blobIds.length > 0) {
        setImageUrls(prevUrls => {
          const next = { ...prevUrls };
          for (const bid of blobIds) {
            if (next[bid]) {
              URL.revokeObjectURL(next[bid]);
              delete next[bid];
            }
          }
          return next;
        });
        deleteImageBlobs(blobIds);
      }
    }
    setColumns(prev => {
      const next = prev.filter(c => c.id !== id);
      columnsRef.current = next;
      return next;
    });
  }, []);

  const requestRemove = useCallback((id: string) => {
    setPendingRemoveId(id);
  }, []);

  const confirmRemove = useCallback(() => {
    if (pendingRemoveId) {
      removeColumn(pendingRemoveId);
      setPendingRemoveId(null);
    }
  }, [pendingRemoveId, removeColumn]);

  const cancelRemove = useCallback(() => {
    setPendingRemoveId(null);
  }, []);

  const addRefImageFromUrl = useCallback(async (colId: string, url: string) => {
    if (!url.trim()) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setColumns(prev =>
          prev.map(c =>
            c.id === colId ? { ...c, refImages: [...c.refImages, result].slice(0, 16) } : c
          )
        );
      };
      reader.readAsDataURL(blob);
    } catch {
      // ignore
    }
  }, []);

  // 用户手动添加图片到暂存区
  const addImageToGallery = useCallback(async (url: string) => {
    const finalUrl = await httpUrlToDataUrl(url);
    setReferenceGallery(prev => {
      if (prev.some(item => item.url === finalUrl)) return prev;
      return [...prev, { url: finalUrl, name: `参考图 ${prev.length + 1}`, origin: undefined }];
    });
  }, []);

  const loadPresetImages = useCallback(async (colId: string) => {
    for (const url of PRESET_IMAGES) {
      await addRefImageFromUrl(colId, url);
    }
  }, [addRefImageFromUrl]);

  const removeRefImage = useCallback((colId: string, idx: number) => {
    setColumns(prev =>
      prev.map(c => (c.id === colId ? { ...c, refImages: c.refImages.filter((_, i) => i !== idx) } : c))
    );
  }, []);

  const addLog = useCallback((colId: string, msg: string) => {
    setColumns(prev => {
      const next = prev.map(c => (c.id === colId ? { ...c, logs: [...c.logs, msg] } : c));
      columnsRef.current = next;
      return next;
    });
  }, []);

  const generate = useCallback(
    async (col: ColumnConfig) => {
      if (!apiKey) {
        alert('Please enter API Key in the header');
        return;
      }
      if (!col.prompt.trim()) {
        alert('Please enter a prompt');
        return;
      }

      const sizeMap: Record<string, string> = {
        '1:1-1k': '1024x1024',
        '1:1-2k': '2048x2048',
        '1:1-4k': '2880x2880',
        '16:9-1k': '1280x720',
        '16:9-2k': '2560x1440',
        '16:9-4k': '3840x2160',
        '9:16-1k': '720x1280',
        '9:16-2k': '1440x2560',
        '9:16-4k': '2160x3840',
        '4:3-1k': '1024x768',
        '4:3-2k': '2048x1536',
        '4:3-4k': '2880x2160',
        '3:4-1k': '768x1024',
        '3:4-2k': '1536x2048',
        '3:4-4k': '2160x2880',
        '2:3-1k': '683x1024',
        '2:3-2k': '1365x2048',
        '2:3-4k': '1920x2880',
        '3:2-1k': '1024x683',
        '3:2-2k': '2048x1365',
        '3:2-4k': '2880x1920',
        '4:5-1k': '819x1024',
        '4:5-2k': '1638x2048',
        '4:5-4k': '2304x2880',
        '5:4-1k': '1024x819',
        '5:4-2k': '2048x1638',
        '5:4-4k': '2880x2304',
        '21:9-1k': '2560x1080',
        '21:9-2k': '3440x1440',
        '21:9-4k': '5120x2160',
      };

      const startTime = Date.now();
      // 检查是否已存在未完成的 pending item（刷新恢复中断任务时）
      const existingPending = col.results.find(r => !r.imageUrl && !r.errorMessage);
      // 复用已有 pending item 的快照配置，或创建新的（首次生成）
      const pendingId = existingPending?.id || `img_${startTime}_${Math.random().toString(36).slice(2, 8)}`;
      const snapModel = existingPending?.model || col.model;
      const snapAspectRatio = existingPending?.aspectRatio || col.aspectRatio;
      const snapResolution = existingPending?.resolution || col.resolution;
      const snapPrompt = existingPending?.prompt || col.prompt;
      const snapRefImages = existingPending?.refImages || col.refImages;
      const snapTimestamp = existingPending?.timestamp || startTime;
      // 根据快照配置计算尺寸字符串
      const sizeStr = sizeMap[`${snapAspectRatio}-${snapResolution}`] || '1024x1024';

      // 收集初始日志，一次性 setState
      const initialLogs: string[] = [
        `Starting ${snapModel}...`,
        `Size: ${sizeStr}`,
      ];
      if (snapModel.includes('nano-banana')) {
        initialLogs.push('Sending POST /v1/images/generations...');
      }
      const abortController = new AbortController();
      abortControllersRef.current.set(pendingId, abortController);
      const signal = abortController.signal;
      updateColumn(col.id, (prevCol) => ({
        isGenerating: true,
        logs: initialLogs,
        results: [{
          id: pendingId,
          model: snapModel,
          aspectRatio: snapAspectRatio,
          resolution: snapResolution,
          prompt: snapPrompt,
          refImages: snapRefImages,
          timestamp: snapTimestamp,
          duration: 0,
        }, ...prevCol.results.filter(r => r.imageUrl || r.errorMessage)],
      }));

      try {
        if (snapModel.includes('nano-banana')) {
          let imageUrls: string[] = [];
          if (col.refImages.length > 0) {
            addLog(col.id, `[nano-banana] Loading ${col.refImages.length} reference image(s)...`);
            for (let i = 0; i < col.refImages.length; i++) {
              try {
                let fetchUrl = col.refImages[i];
                const headers: Record<string, string> = {};
                if (fetchUrl.startsWith('https://ai.t8star.org')) {
                  headers['Authorization'] = `Bearer ${apiKey}`;
                  fetchUrl = fetchUrl.replace('https://ai.t8star.org', '/api/t8star');
                } else if (fetchUrl.startsWith('http')) {
                  fetchUrl = `/api/proxy-image?url=${encodeURIComponent(fetchUrl)}`;
                }
                const fetchRes = await fetch(fetchUrl, { headers });
                const blob = await fetchRes.blob();
                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve, reject) => {
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
                imageUrls.push(base64);
              } catch {
                addLog(col.id, `[nano-banana] Failed to load ref image ${i}`);
              }
            }
          }

          const requestBody = {
            model: snapModel,
            prompt: snapPrompt,
            response_format: 'url',
            aspect_ratio: snapAspectRatio,
            image_size: snapResolution.toUpperCase(),
            ...(imageUrls.length > 0 && { image: imageUrls }),
          };

          addLog(col.id, '[nano-banana] Sending POST /v1/images/generations...');
          const res = await fetch('/api/t8star/v1/images/generations', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal,
          });

          const text = await res.text();
          console.log('[nano-banana] Response:', text);
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error('[nano-banana] Invalid JSON response');
          }
          if (!res.ok) {
            throw new Error(`[nano-banana] API Error: ${data.message || data.error?.message || res.statusText}`);
          }

          addLog(col.id, `[nano-banana] Response keys: ${Object.keys(data).join(', ')}`);
          console.log('[nano-banana] Parsed data:', data);

          if (data.data && data.data[0] && data.data[0].url) {
            const originalUrl = data.data[0].url;
            const imageId = await saveImageBlob(originalUrl, pendingId);
            const urls = await loadImageBlobUrls([imageId]);
            setImageUrls(prev => ({ ...prev, ...urls }));
            updateColumn(col.id, (prevCol) => ({
              results: prevCol.results.map(r => r.id === pendingId ? {
                ...r,
                timestamp: Date.now(),
                duration: Math.round((Date.now() - startTime) / 1000),
                imageUrl: originalUrl,
              } : r),
            }));
            addLog(col.id, '[nano-banana] Done!');
            return;
          }

          const taskId = data.task_id || data.data;
          if (!taskId) {
            addLog(col.id, `[nano-banana] No task_id found. Response: ${text.substring(0, 200)}`);
            throw new Error('[nano-banana] No task ID');
          }
          addLog(col.id, `[nano-banana] Task: ${taskId}`);

          let attempts = 0;
          while (attempts < 60) {
            if (signal.aborted) throw new DOMException('[nano-banana] Aborted', 'AbortError');
            attempts++;
            await new Promise(r => setTimeout(r, 5000));
            if (signal.aborted) throw new DOMException('[nano-banana] Aborted', 'AbortError');
            addLog(col.id, `[nano-banana] Polling ${attempts}...`);
            const statusRes = await fetch(`/api/t8star/v1/images/tasks/${taskId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal,
            });
            const statusText = await statusRes.text();
            let statusData;
            try {
              statusData = JSON.parse(statusText);
            } catch {
              continue;
            }
            const inner = statusData.data || {};
            const state = inner.status;
            addLog(col.id, `[nano-banana] Status: ${state}`);
            if (state === 'SUCCESS') {
              const resData = inner.data?.data?.[0];
              if (resData && resData.url) {
                const originalUrl = resData.url;
                const imageId = await saveImageBlob(originalUrl, pendingId);
                const urls = await loadImageBlobUrls([imageId]);
                setImageUrls(prev => ({ ...prev, ...urls }));
                updateColumn(col.id, (prevCol) => ({
                  results: prevCol.results.map(r => r.id === pendingId ? {
                    ...r,
                    timestamp: Date.now(),
                    duration: Math.round((Date.now() - startTime) / 1000),
                    imageUrl: originalUrl,
                  } : r),
                }));
                addLog(col.id, '[nano-banana] Done!');
                return;
              }
              throw new Error('[nano-banana] Unexpected response structure');
            } else if (state === 'FAILURE') {
              throw new Error(`[nano-banana] Failed: ${inner.fail_reason}`);
            }
          }
          throw new Error('[nano-banana] Timeout (60 attempts)');
        } else if (snapModel === 'gpt-image-2-2in1') {
          // 2in1 竞速：同时跑 gpt-image-2 (A) 和 gpt-image-2-all (B)，先到先用，
          // 赢者 abort 输者（停止轮询即可），两个都失败才算失败
          const [wStr, hStr] = sizeStr.split('x');
          const targetW = parseInt(wStr, 10);
          const targetH = parseInt(hStr, 10);

          // 准备共享的参考图 blob（两个任务共用，避免重复 fetch）
          let imageBlobs: { blob: Blob; name: string }[] = [];
          if (col.refImages.length > 0) {
            addLog(col.id, `[2in1] Loading ${col.refImages.length} reference image(s)...`);
            for (let i = 0; i < col.refImages.length; i++) {
              try {
                let fetchUrl = col.refImages[i];
                const headers: Record<string, string> = {};
                if (fetchUrl.startsWith('https://ai.t8star.org')) {
                  headers['Authorization'] = `Bearer ${apiKey}`;
                  fetchUrl = fetchUrl.replace('https://ai.t8star.org', '/api/t8star');
                } else if (fetchUrl.startsWith('http')) {
                  fetchUrl = `/api/proxy-image?url=${encodeURIComponent(fetchUrl)}`;
                }
                const fetchRes = await fetch(fetchUrl, { headers });
                const blob = await fetchRes.blob();
                imageBlobs.push({ blob, name: `reference_${i}.png` });
              } catch {
                addLog(col.id, `[2in1] Failed to load ref image ${i}`);
              }
            }
          }
          if (imageBlobs.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = 'white';
              ctx.fillRect(0, 0, targetW, targetH);
            }
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (blob) imageBlobs.push({ blob, name: 'image_0.png' });
          }

          // 单模型生图：提交任务 + 轮询，返回原始图片 URL
          const runSingle = async (modelName: string, signal: AbortSignal, tag: string): Promise<string> => {
            const formData = new FormData();
            formData.append('prompt', snapPrompt);
            formData.append('model', modelName);
            formData.append('n', '1');
            formData.append('quality', col.quality);
            formData.append('size', sizeStr);
            imageBlobs.forEach(item => formData.append('image', item.blob, item.name));

            addLog(col.id, `[${tag}] POST /v1/images/edits?async=true (model: ${modelName})...`);
            const res = await fetch('/api/t8star/v1/images/edits?async=true', {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
              signal,
            });
            const text = await res.text();
            let data;
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error(`[${tag}] Invalid JSON response`);
            }
            if (!res.ok) {
              throw new Error(`[${tag}] API Error: ${data.message || data.error?.message || res.statusText}`);
            }
            const taskId = data.task_id || data.data;
            if (!taskId) throw new Error(`[${tag}] No task ID`);
            addLog(col.id, `[${tag}] Task: ${taskId}`);

            let attempts = 0;
            while (attempts < 60) {
              if (signal.aborted) throw new DOMException(`[${tag}] Aborted`, 'AbortError');
              attempts++;
              await new Promise(r => setTimeout(r, 5000));
              if (signal.aborted) throw new DOMException(`[${tag}] Aborted`, 'AbortError');
              addLog(col.id, `[${tag}] Polling ${attempts}...`);
              const statusRes = await fetch(`/api/t8star/v1/images/tasks/${taskId}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal,
              });
              const statusText = await statusRes.text();
              let statusData;
              try {
                statusData = JSON.parse(statusText);
              } catch {
                continue;
              }
              const inner = statusData.data || {};
              const state = inner.status;
              addLog(col.id, `[${tag}] Status: ${state}`);
              if (state === 'SUCCESS') {
                const resData = inner.data?.data?.[0];
                if (resData && resData.url) return resData.url;
                throw new Error(`[${tag}] Unexpected response structure`);
              } else if (state === 'FAILURE') {
                throw new Error(`[${tag}] Failed: ${inner.fail_reason}`);
              }
            }
            throw new Error(`[${tag}] Timeout (60 attempts)`);
          };

          // 包一层日志：单个失败/取消时记录，不立即中断（Promise.any 继续等另一个）
          const runSingleWithLog = async (modelName: string, signal: AbortSignal, tag: string): Promise<string> => {
            try {
              return await runSingle(modelName, signal, tag);
            } catch (err: any) {
              if (err.name === 'AbortError') {
                addLog(col.id, `[${tag}] Cancelled (lost race)`);
              } else {
                addLog(col.id, `[${tag}] Failed: ${err.message}`);
              }
              throw err;
            }
          };

          addLog(col.id, '[2in1] Racing gpt-image-2 (A) vs gpt-image-2-all (B)...');
          try {
            const winnerUrl = await Promise.any([
              runSingleWithLog('gpt-image-2', signal, 'A'),
              runSingleWithLog('gpt-image-2-all', signal, 'B'),
            ]);
            abortController.abort(); // 取消输者
            addLog(col.id, '[2in1] Winner resolved. Saving image...');

            const imageId = await saveImageBlob(winnerUrl, pendingId);
            const urls = await loadImageBlobUrls([imageId]);
            setImageUrls(prev => ({ ...prev, ...urls }));
            updateColumn(col.id, (prevCol) => ({
              results: prevCol.results.map(r => r.id === pendingId ? {
                ...r,
                timestamp: Date.now(),
                duration: Math.round((Date.now() - startTime) / 1000),
                imageUrl: winnerUrl,
              } : r),
            }));
            addLog(col.id, '[2in1] Done!');
          } catch (aggErr: any) {
            // 两个都失败，抛出最后一个错误交由外层 catch 统一处理
            const errors = (aggErr as AggregateError).errors || [aggErr];
            const lastErr = errors[errors.length - 1];
            throw lastErr instanceof Error ? lastErr : new Error('Both models failed');
          }
        } else {
          // GPT Image 2 path (multipart + async polling)
          const [wStr, hStr] = sizeStr.split('x');
          const targetW = parseInt(wStr, 10);
          const targetH = parseInt(hStr, 10);

          let imageBlobs: { blob: Blob; name: string }[] = [];
          if (col.refImages.length > 0) {
            addLog(col.id, `Using ${col.refImages.length} reference image(s)...`);
            for (let i = 0; i < col.refImages.length; i++) {
              try {
                let fetchUrl = col.refImages[i];
                const headers: Record<string, string> = {};
                if (fetchUrl.startsWith('https://ai.t8star.org')) {
                  headers['Authorization'] = `Bearer ${apiKey}`;
                  fetchUrl = fetchUrl.replace('https://ai.t8star.org', '/api/t8star');
                } else if (fetchUrl.startsWith('http')) {
                  fetchUrl = `/api/proxy-image?url=${encodeURIComponent(fetchUrl)}`;
                }
                const fetchRes = await fetch(fetchUrl, { headers });
                const blob = await fetchRes.blob();
                imageBlobs.push({ blob, name: `reference_${i}.png` });
              } catch {
                addLog(col.id, `Failed to load ref image ${i}`);
              }
            }
          }

          if (imageBlobs.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = 'white';
              ctx.fillRect(0, 0, targetW, targetH);
            }
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (blob) imageBlobs.push({ blob, name: 'image_0.png' });
          }

          const formData = new FormData();
          formData.append('prompt', snapPrompt);
          formData.append('model', snapModel);
          formData.append('n', '1');
          formData.append('quality', col.quality);
          formData.append('size', sizeStr);
          imageBlobs.forEach(item => formData.append('image', item.blob, item.name));

          addLog(col.id, 'Sending POST /v1/images/edits?async=true...');
          const res = await fetch('/api/t8star/v1/images/edits?async=true', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
            signal,
          });

          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error('Invalid JSON response');
          }

          if (!res.ok) {
            throw new Error(`API Error: ${data.message || data.error?.message || res.statusText}`);
          }

          const taskId = data.task_id || data.data;
          if (!taskId) throw new Error('No task ID');
          addLog(col.id, `Task: ${taskId}`);

          let attempts = 0;
          while (attempts < 60) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            attempts++;
            await new Promise(r => setTimeout(r, 5000));
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            addLog(col.id, `Polling ${attempts}...`);

            const statusRes = await fetch(`/api/t8star/v1/images/tasks/${taskId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal,
            });
            const statusText = await statusRes.text();
            let statusData;
            try {
              statusData = JSON.parse(statusText);
            } catch {
              continue;
            }
            const inner = statusData.data || {};
            const state = inner.status;
            addLog(col.id, `Status: ${state}`);

            if (state === 'SUCCESS') {
              const resData = inner.data?.data?.[0];
              if (resData && resData.url) {
                const originalUrl = resData.url;
                const imageId = await saveImageBlob(originalUrl, pendingId);
                const urls = await loadImageBlobUrls([imageId]);
                setImageUrls(prev => ({ ...prev, ...urls }));
                updateColumn(col.id, (prevCol) => ({
                  results: prevCol.results.map(r => r.id === pendingId ? {
                    ...r,
                    timestamp: Date.now(),
                    duration: Math.round((Date.now() - startTime) / 1000),
                    imageUrl: originalUrl,
                  } : r),
                }));
              }
              break;
            } else if (state === 'FAILURE') {
              throw new Error(`Failed: ${inner.fail_reason}`);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // 用户中断：不显示错误卡片，pending item 已被中断按钮移除
          addLog(col.id, '已中断');
        } else {
          const errMsg = err.message || 'Unknown error';
          addLog(col.id, `Error: ${errMsg}`);
          updateColumn(col.id, (prevCol) => ({
            results: prevCol.results.map(r => r.id === pendingId ? {
              ...r,
              timestamp: Date.now(),
              duration: Math.round((Date.now() - startTime) / 1000),
              errorMessage: errMsg,
            } : r),
          }));
        }
      } finally {
        abortControllersRef.current.delete(pendingId);
        updateColumn(col.id, { isGenerating: false });
      }
    },
    [apiKey, updateColumn, addLog]
  );

  // 中断某个生成任务：abort 轮询/fetch + 移除 pending item
  const abortGenerate = useCallback((pendingId: string, colId: string) => {
    abortControllersRef.current.get(pendingId)?.abort();
    abortControllersRef.current.delete(pendingId);
    updateColumn(colId, (prev) => ({
      isGenerating: false,
      results: prev.results.filter(r => r.id !== pendingId),
    }));
  }, [updateColumn]);

  const previewRatio = ASPECT_PREVIEW_RATIO;

  return (
    <>
    {/* Loading 覆盖层：在 scroll 恢复前全屏遮罩，恢复后淡出 */}
    <div
      className="fixed inset-0 z-[99999] bg-[#f1f5f9] flex flex-col items-center justify-center transition-opacity duration-500"
      style={{ opacity: pageReady ? 0 : 1, pointerEvents: pageReady ? 'none' : 'auto' }}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 bg-[#4f39f6] rounded-xl flex items-center justify-center text-white">
          <Star className="w-5 h-5" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="font-semibold text-base text-[#1d1d1f]">I MAGINE</span>
          <span className="text-[11px] text-[#86868b]">1.0</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="w-2 h-2 rounded-full bg-[#4f39f6] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#4f39f6] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#4f39f6] animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-xs text-[#86868b] mt-1">正在恢复工作区...</span>
      </div>
    </div>

    <div className="w-screen h-dvh overflow-hidden">
      <div
        className="bg-[#f1f5f9] text-[#1d1d1f] flex flex-col font-sans overflow-hidden relative"
        style={{ width: 'calc(100vw / 1.1)', height: 'calc(100dvh / 1.1)', transform: 'scale(1.1)', transformOrigin: 'top left' }}
      >
      {/* Header — 完全干净的顶栏 */}
      <header className="bg-white py-2 px-6 z-50 flex-shrink-0 border-b border-zinc-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 bg-[#4f39f6] rounded-lg flex items-center justify-center text-white">
              <Star className="w-4 h-4" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="font-semibold text-base">I MAGINE</span>
              <span className="text-[11px] text-[#86868b]">1.0</span>
            </div>
            {/* 项目下拉菜单 */}
            <div className="relative" ref={projectMenuRef}>
              <button
                onClick={() => { setProjectMenuOpen(!projectMenuOpen); setEditingProjectId(null); }}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-[#f0f0f2] hover:bg-[#e5e5e7] rounded text-[#86868b] font-['Inter'] font-semibold transition-colors"
              >
                <span>{currentProject?.name || '默认项目'}</span>
                <svg className={`w-3 h-3 transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {projectMenuOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-zinc-200/50 py-1 z-50">
                  {projects.map(p => (
                    <div key={p.id} className="flex items-center px-3 py-1.5 group hover:bg-zinc-50">
                      {editingProjectId === p.id ? (
                        <input autoFocus defaultValue={p.name} onKeyDown={e => { if (e.key === 'Enter') renameProject(p.id, e.currentTarget.value); if (e.key === 'Escape') setEditingProjectId(null); }} onBlur={e => renameProject(p.id, e.target.value)} className="flex-1 text-[12px] bg-zinc-100 rounded px-1.5 py-0.5 focus:outline-none ring-1 ring-[#4f39f6]/30" onClick={e => e.stopPropagation()} />
                      ) : (
                        <button onClick={() => switchProject(p.id)} className={`flex-1 text-left text-[12px] py-0.5 font-['Inter'] transition-colors ${p.id === currentProjectId ? 'text-[#4f39f6] font-semibold' : 'text-[#86868b]'}`}>{p.name}</button>
                      )}
                      {p.id === currentProjectId && editingProjectId !== p.id && <span className="text-[10px] text-[#4f39f6] mr-1">✓</span>}
                      {editingProjectId !== p.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); setEditingProjectId(p.id); }} className="p-0.5 text-[#86868b] hover:text-[#4f39f6]" title="重命名"><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} className="p-0.5 text-[#86868b] hover:text-[#ff3b30]" title="删除"><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={createProject} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[#4f39f6] hover:bg-zinc-50 font-['Inter'] font-semibold transition-colors border-t border-zinc-100 mt-1"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>新建项目</button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5 text-[11px] text-[#86868b]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
              <span className="font-['Inter'] font-semibold">已保存</span>
            </div>
            <div className={`flex items-center space-x-1.5 text-[11px] ${storageUsage.percent >= 90 ? 'text-[#ff3b30]' : storageUsage.percent >= 70 ? 'text-[#ff9500]' : 'text-[#86868b]'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span className="font-['Inter'] font-semibold">存储 {storageUsage.percent}%</span>
            </div>
            {!isProd && (<>
            <div className={`flex items-center space-x-1.5 text-[11px] ${apiStatus === 'online' ? 'text-[#34c759]' : apiStatus === 'offline' ? 'text-[#ff3b30]' : 'text-[#ff9500]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${apiStatus === 'online' ? 'bg-[#34c759]' : apiStatus === 'offline' ? 'bg-[#ff3b30]' : 'bg-[#ff9500] animate-pulse'}`} />
              <span className="font-['Inter'] font-semibold">{apiStatus === 'online' ? '接口正常' : apiStatus === 'offline' ? '接口断开' : '检测中...'}</span>
            </div>
            <button onClick={onOpenSandbox} className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#f0f0f2] hover:bg-[#e5e5e7] rounded-lg text-[11px] text-[#86868b] transition-colors"><Code2 className="w-3.5 h-3.5" /><span className="leading-none font-['Inter'] font-semibold">接口</span></button>
            <button onClick={() => setShowAgentPromptEditor(true)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#f0f0f2] hover:bg-[#e5e5e7] rounded-lg text-[11px] text-[#86868b] transition-colors"><Bug className="w-3.5 h-3.5" /><span className="leading-none font-['Inter'] font-semibold">调试</span></button>
            <button onClick={() => setShowAgentLog(true)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#f0f0f2] hover:bg-[#e5e5e7] rounded-lg text-[11px] text-[#86868b] transition-colors"><ScrollText className="w-3.5 h-3.5" /><span className="leading-none font-['Inter'] font-semibold">日志</span></button>
            <button onClick={() => setShowAgentSettings(true)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#f0f0f2] hover:bg-[#e5e5e7] rounded-lg text-[11px] text-[#86868b] transition-colors"><Settings className="w-3.5 h-3.5" /><span className="leading-none font-['Inter'] font-semibold">设置</span></button>
            </>)}
          </div>
        </div>
      </header>

      {/* mini 面板 — 默认（窄条，垂直居中） */}
      {!galleryExpanded && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-[200] w-12 bg-white rounded-2xl shadow-xl flex flex-col"
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setIsDraggingToGallery(true); }}
          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDraggingToGallery(true); }}
          onDragLeave={e => { e.stopPropagation(); setIsDraggingToGallery(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setIsDraggingToGallery(false);
            if (e.dataTransfer.files?.length > 0) {
              Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).forEach(file => {
                const reader = new FileReader();
                reader.onload = () => addImageToGallery(reader.result as string);
                reader.readAsDataURL(file);
              });
              return;
            }
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && !url.includes('\n')) addImageToGallery(url);
          }}
        >
          {/* 图片列表 — 仅缩略图，无头部 */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
            {referenceGallery.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center px-1">
                <ImageIcon className="w-5 h-5 text-[#d1d1d6] mb-2" />
                <p className="text-[8px] text-[#c7c7cc] font-['Inter']">拖入图片</p>
              </div>
            ) : (
              referenceGallery.map((item, idx) => (
                <div key={idx} className="relative group">
                  <div className="w-full aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-50"
                    data-agent-col="__gallery__"
                    data-agent-type="gallery-image"
                    data-agent-item={String(idx)}>
                    <img
                      src={item.url}
                      alt={item.name}
                      data-agent-image-url={item.url}
                      draggable="true"
                      onDragStart={(e) => { e.dataTransfer.setData('text/uri-list', item.url); e.dataTransfer.setData('text/plain', item.url); }}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <button
                    onClick={() => setReferenceGallery(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-[#ff3b30] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#e03530]"
                  >
                    <X className="w-2 h-2" />
                  </button>
                </div>
              ))
            )}
          </div>


          {/* 右侧展开按钮 */}
          <button
            onClick={() => setGalleryExpanded(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[201] w-5 h-10 flex items-center justify-center text-[#4f39f6] hover:text-[#3e2fd9] transition-colors"
            title="展开暂存区"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* URL 输入弹出 */}
          {showGalleryInput && (
            <div className="absolute left-full top-0 ml-2 z-50 w-60 bg-white rounded-xl border border-zinc-200 shadow-lg p-2 flex gap-1.5">
              <input
                type="text"
                value={galleryInputUrl}
                onChange={e => setGalleryInputUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && galleryInputUrl.trim()) { addImageToGallery(galleryInputUrl.trim()); setGalleryInputUrl(''); setShowGalleryInput(false); } }}
                placeholder="粘贴图片 URL..."
                className="flex-1 bg-[#f1f5f9] border border-zinc-200 rounded-lg px-2 py-1.5 text-[11px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#4f39f6]/30"
                autoFocus
              />
              <button onClick={() => { if (galleryInputUrl.trim()) { addImageToGallery(galleryInputUrl.trim()); setGalleryInputUrl(''); setShowGalleryInput(false); } }} className="px-2 py-1.5 bg-[#4f39f6] text-white rounded-lg text-[10px] font-['Inter'] font-semibold hover:bg-[#3e2fd9] transition-colors">添加</button>
            </div>
          )}

          {/* 拖入提示 */}
          {isDraggingToGallery && (
            <div className="absolute inset-0 z-10 bg-[#4f39f6]/10 border-2 border-dashed border-[#4f39f6] flex items-center justify-center pointer-events-none">
              <span className="text-[14px] font-['Inter'] font-semibold text-[#4f39f6] bg-white/80 px-4 py-2 rounded-lg">释放以添加到暂存区</span>
            </div>
          )}
        </div>
      )}

      {/* full 面板 — 完整暂存区 */}
      {galleryExpanded && (
        <div className="absolute left-3 top-[52px] bottom-3 z-[200] w-[260px] bg-white rounded-2xl shadow-xl flex flex-col"
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setIsDraggingToGallery(true); }}
          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDraggingToGallery(true); }}
          onDragLeave={e => { e.stopPropagation(); setIsDraggingToGallery(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setIsDraggingToGallery(false);
            if (e.dataTransfer.files?.length > 0) {
              Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).forEach(file => {
                const reader = new FileReader();
                reader.onload = () => addImageToGallery(reader.result as string);
                reader.readAsDataURL(file);
              });
              return;
            }
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && !url.includes('\n')) addImageToGallery(url);
          }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[#4f39f6]" />
              <span className="text-[13px] font-['Inter'] font-semibold text-[#1d1d1f]">暂存区</span>
              {referenceGallery.length > 0 && (
                <span className="text-[11px] text-[#86868b] font-['Inter']">{referenceGallery.length}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowGalleryInput(true)} className="p-1 text-[#86868b] hover:text-[#4f39f6] hover:bg-zinc-100 rounded transition-colors" title="粘贴图片链接">
                <Link2 className="w-3.5 h-3.5" />
              </button>
              {referenceGallery.length > 0 && (
                <button onClick={() => setReferenceGallery([])} className="p-1 text-[#86868b] hover:text-[#ff3b30] hover:bg-red-50 rounded transition-colors" title="清空">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            </div>

          {/* 右侧收起按钮 */}
           <button
             onClick={() => setGalleryExpanded(false)}
             className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[201] w-5 h-10 flex items-center justify-center text-[#4f39f6] hover:text-[#3e2fd9] transition-colors"
             title="收起暂存区"
           >
             <ChevronRight className="w-3.5 h-3.5 rotate-180" />
           </button>

          {/* URL 输入 */}
          {showGalleryInput && (
            <div className="px-3 py-2 border-b border-zinc-100 flex gap-2">
              <input
                type="text"
                value={galleryInputUrl}
                onChange={e => setGalleryInputUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && galleryInputUrl.trim()) { addImageToGallery(galleryInputUrl.trim()); setGalleryInputUrl(''); } }}
                placeholder="粘贴图片 URL..."
                className="flex-1 bg-[#f1f5f9] border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[12px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#4f39f6]/30"
                autoFocus
              />
              <button onClick={() => { if (galleryInputUrl.trim()) { addImageToGallery(galleryInputUrl.trim()); setGalleryInputUrl(''); } }} className="px-2.5 py-1.5 bg-[#4f39f6] text-white rounded-lg text-[11px] font-['Inter'] font-semibold hover:bg-[#3e2fd9] transition-colors">添加</button>
            </div>
          )}

          {/* 图片列表 */}
          <div className="flex-1 overflow-y-auto p-3">
            {referenceGallery.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <ImageIcon className="w-8 h-8 text-[#d1d1d6] mb-3" />
                <p className="text-[12px] text-[#86868b] font-['Inter'] mb-2">暂存区为空</p>
                <p className="text-[11px] text-[#c7c7cc] font-['Inter']">拖入图片或粘贴链接</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {referenceGallery.map((item, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-50"
                       data-agent-col="__gallery__"
                       data-agent-type="gallery-image"
                       data-agent-item={String(idx)}>
                       <img
                          src={item.url}
                          alt={item.name}
                          data-agent-image-url={item.url}
                          draggable="true"
                          onDragStart={(e) => { e.dataTransfer.setData('text/uri-list', item.url); e.dataTransfer.setData('text/plain', item.url); }}
                          className="w-full h-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      <button
                        onClick={() => setReferenceGallery(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 left-1 w-5 h-5 bg-[#ff3b30] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#e03530]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[9px] px-1.5 py-0.5 rounded font-['Inter'] opacity-0 group-hover:opacity-100 transition-opacity">
                        {idx + 1}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* 拖入提示 */}
          {isDraggingToGallery && (
            <div className="absolute inset-0 z-10 bg-[#4f39f6]/10 border-2 border-dashed border-[#4f39f6] flex items-center justify-center pointer-events-none">
              <span className="text-[14px] font-['Inter'] font-semibold text-[#4f39f6] bg-white/80 px-4 py-2 rounded-lg">释放以添加到暂存区</span>
            </div>
          )}
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div ref={horizontalScrollRef} className="flex-1 overflow-x-auto min-h-0 px-5 pt-4 pb-3" onScroll={handleHorizontalScroll}> 
          <div className="flex gap-4 h-full items-stretch min-w-max mx-auto">
            <div className="w-[50vw]" />
            {/* Left Add Button */}
            <button
              onClick={addColumnAtStart}
              className="flex-shrink-0 w-[408px] flex flex-col items-center justify-center bg-white rounded-2xl hover:bg-[#f0f0f2] transition-all group"
            >
              <Plus className="w-8 h-8 text-[#d1d1d6] group-hover:text-[#4f39f6] transition-colors mb-3" />
              <span className="text-[13px] text-[#86868b] group-hover:text-[#4f39f6] transition-colors">
                新建生图列
              </span>
            </button>

            {columns.map((col, idx) => (
                <ColumnCard
                  col={col}
                  colIndex={idx}
                  totalCols={columns.length}
                  imageUrls={imageUrls}
                  onUpdate={updateColumn}
                  onRequestRemove={requestRemove}
                  onAddBetween={addColumnBetween}
                  onGenerate={generate}
                  onAddRefUrl={addRefImageFromUrl}
                  onLoadPresets={loadPresetImages}
                  onRemoveRef={removeRefImage}
                  onAbort={abortGenerate}
                  previewRatio={ASPECT_PREVIEW_RATIO}
                  timers={timers}
                  refPreview={refPreview}
                  onRefPreview={setRefPreview}
                  onColumnScroll={handleColumnScroll}
                  columnScrollTop={scrollPositions.v[col.id] || 0}
                  registerColumnScrollRef={registerColumnScrollRef}
                />
              ))}

            {/* Right Add Button */}
            <button
              onClick={addColumnAtEnd}
              className="flex-shrink-0 w-[408px] flex flex-col items-center justify-center bg-white rounded-2xl hover:bg-[#f0f0f2] transition-all group"
            >
              <Plus className="w-8 h-8 text-[#d1d1d6] group-hover:text-[#4f39f6] transition-colors mb-3" />
              <span className="text-[13px] text-[#86868b] group-hover:text-[#4f39f6] transition-colors">
                新建生图列
              </span>
            </button>
            <div className="w-[50vw]" />
            </div>
        </div>
      </main>

      {/* 自定义确认弹窗 - 删除列 */}
      {pendingRemoveId && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-[320px]">
            <p className="text-[14px] text-[#1d1d1f] mb-6">确定要删除该生图列吗？</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelRemove}
                className="px-4 py-2 rounded-lg text-[13px] text-[#86868b] bg-[#f1f5f9] hover:bg-[#e5e5e7] transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmRemove}
                className="px-4 py-2 rounded-lg text-[13px] text-white bg-[#ff3b30] hover:bg-[#e03530] transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteProjectId && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onMouseDown={() => setPendingDeleteProjectId(null)}>
          <div className="bg-white rounded-2xl p-6 w-[340px]" onMouseDown={e => e.stopPropagation()}>
            <p className="text-[14px] text-[#1d1d1f] mb-2">确定要删除项目吗？</p>
            <p className="text-[12px] text-[#86868b] mb-6">
              项目「{projects.find(p => p.id === pendingDeleteProjectId)?.name}」的列配置和滚动位置将被删除，生成的图片仍保留。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setPendingDeleteProjectId(null)}
                className="px-4 py-2 rounded-lg text-[13px] text-[#86868b] bg-[#f1f5f9] hover:bg-[#e5e5e7] transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => confirmDeleteProject()}
                className="px-4 py-2 rounded-lg text-[13px] text-white bg-[#ff3b30] hover:bg-[#e03530] transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 新建项目弹窗 */}
      {showNewProjectModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onMouseDown={() => { setShowNewProjectModal(false); setNewProjectName(''); }}>
          <div className="bg-white rounded-2xl p-6 w-[340px]" onMouseDown={e => e.stopPropagation()}>
            <p className="text-[14px] text-[#1d1d1f] mb-4 font-semibold">新建项目</p>
            <input
              autoFocus
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreateProject(); if (e.key === 'Escape') { setShowNewProjectModal(false); setNewProjectName(''); } }}
              placeholder="请输入项目名称"
              className="w-full bg-[#f1f5f9] border border-zinc-200 rounded-lg p-2.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#4f39f6]/30 mb-4"
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => { setShowNewProjectModal(false); setNewProjectName(''); }}
                className="px-4 py-2 rounded-lg text-[13px] text-[#86868b] bg-[#f1f5f9] hover:bg-[#e5e5e7] transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmCreateProject}
                className="px-4 py-2 rounded-lg text-[13px] text-white bg-[#4f39f6] hover:bg-[#3e2fd9] transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Agent API Key 设置弹窗 */}
      {showAgentSettings && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowAgentSettings(false)}>
          <div className="bg-white rounded-2xl p-6 w-[380px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Agent 设置</h3>
              <button onClick={() => setShowAgentSettings(false)} className="text-[#86868b] hover:text-[#1d1d1f]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 mb-4">
              <label className="text-[11px] text-[#86868b] uppercase">百炼 API Key（Anthropic 兼容）</label>
              <input
                type="password"
                value={agentApiKey}
                onChange={(e) => {
                  setAgentApiKey(e.target.value);
                  localStorage.setItem('agent_qwen_api_key', e.target.value);
                }}
                placeholder="sk-..."
                className="w-full bg-[#f1f5f9] border border-[#e5e5e7] focus:border-[#4f39f6] rounded-lg px-3 py-2.5 text-sm text-[#1d1d1f] placeholder-[#c7c7cc] focus:outline-none"
                autoComplete="off"
              />
              <p className="text-[10px] text-[#a1a1a6]">
                从 <a href="https://platform.qianwenai.com/home/api-keys" target="_blank" rel="noreferrer" className="text-[#4f39f6] underline">platform.qianwenai.com</a> 获取 API Key
              </p>
            </div>
            <div className="space-y-1.5 mb-4">
              <label className="text-[11px] text-[#86868b] uppercase">博查 API Key（联网搜索）</label>
              <input
                type="password"
                value={bochaApiKey}
                onChange={(e) => {
                  setBochaApiKey(e.target.value);
                  localStorage.setItem('bocha_api_key', e.target.value);
                }}
                placeholder="sk-..."
                className="w-full bg-[#f1f5f9] border border-[#e5e5e7] focus:border-[#4f39f6] rounded-lg px-3 py-2.5 text-sm text-[#1d1d1f] placeholder-[#c7c7cc] focus:outline-none"
                autoComplete="off"
              />
              <p className="text-[10px] text-[#a1a1a6]">
                从 <a href="https://open.bochaai.com/" target="_blank" rel="noreferrer" className="text-[#4f39f6] underline">博查 AI 开放平台</a> 获取 API Key
              </p>
            </div>
            <button
              onClick={() => setShowAgentSettings(false)}
              className="w-full py-2.5 bg-[#4f39f6] hover:bg-[#4338ca] rounded-xl text-sm text-white transition-colors"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {/* Agent 日志查看器 */}
      {showAgentLog && <AgentLogViewer onClose={() => setShowAgentLog(false)} />}

      {/* Agent 提示词编辑器 */}
      {showAgentPromptEditor && <AgentPromptEditor onClose={() => setShowAgentPromptEditor(false)} />}

      {/* Toast 通知 */}
      {toastMsg && createPortal(
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-[#1d1d1f] text-white px-5 py-3 rounded-xl shadow-2xl text-[13px] font-['Inter'] flex items-center gap-2">
            <span>{toastMsg}</span>
            <button onClick={() => setToastMsg(null)} className="ml-2 text-white/60 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
    </div>
    </>
  );
}

function ColumnCard({
  col,
  colIndex,
  totalCols,
  imageUrls,
  onUpdate,
  onRequestRemove,
  onAddBetween,
  onGenerate,
  onAddRefUrl,
  onLoadPresets,
  onRemoveRef,
  onAbort,
  previewRatio,
  timers,
  onColumnScroll,
  columnScrollTop,
  registerColumnScrollRef,
  refPreview,
  onRefPreview,
}: {
  col: ColumnConfig;
  colIndex: number;
  totalCols: number;
  imageUrls: Record<string, string>;
  onUpdate: (id: string, patch: Partial<ColumnConfig> | ((prev: ColumnConfig) => Partial<ColumnConfig>)) => void;
  onRequestRemove: (id: string) => void;
  onAddBetween: (afterIndex: number) => void;
  onGenerate: (col: ColumnConfig) => void;
  onAddRefUrl: (colId: string, url: string) => void;
  onLoadPresets: (colId: string) => void;
  onRemoveRef: (colId: string, idx: number) => void;
  onAbort: (itemId: string, colId: string) => void;
  previewRatio: Record<string, number>;
  timers: Record<string, number>;
  onColumnScroll: (colId: string, scrollTop: number) => void;
  columnScrollTop: number;
  registerColumnScrollRef: (colId: string, ref: HTMLDivElement | null) => void;
  refPreview: { colId: string; url: string } | null;
  onRefPreview: (val: { colId: string; url: string } | null) => void;
}) {
  const [urlInput, setUrlInput] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const panOffset = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const hasDragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [copiedImageId, setCopiedImageId] = useState<string | null>(null);
  const [pendingDeleteImgId, setPendingDeleteImgId] = useState<string | null>(null);
  const [refImageId, setRefImageId] = useState<string | null>(null);
  const [copiedCardConfigId, setCopiedCardConfigId] = useState<string | null>(null);
  const [appliedCardConfigId, setAppliedCardConfigId] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'selected' | 'downloaded'>('all');
  const dragCounter = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const ratio = previewRatio[col.aspectRatio] || 1;

  // @ 提及参考图
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
  const [mentionAtPos, setMentionAtPos] = useState(-1);
  const pendingCursorRef = useRef<number | null>(null);
  // 跟踪上一次同步到 DOM 的 prompt 值。
  // 用户输入时在 handlePromptInput 中更新它，useEffect 据此判断是否需要重写 innerHTML。
  // 这样可以避免用 innerText 比较时因空白/换行符差异导致误判，进而重置光标。
  const lastSyncedPromptRef = useRef<string>('');

  useEffect(() => {
    requestAnimationFrame(() => setEntered(true));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(null);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // 点击任意位置关闭提及列表（包括输入框内）
  useEffect(() => {
    if (!mentionActive) return;
    const handleClick = () => {
      setMentionActive(false);
      setMentionFilter('');
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mentionActive]);

  // 将纯文本偏移量转换为 contenteditable DOM 位置
  const textOffsetToRange = useCallback((editor: HTMLElement, offset: number): Range => {
    const range = document.createRange();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let current = 0;
    let node = walker.nextNode();
    while (node) {
      const len = (node.textContent || '').length;
      if (current + len >= offset) {
        range.setStart(node, offset - current);
        range.collapse(true);
        return range;
      }
      current += len;
      node = walker.nextNode();
    }
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }, []);

  // 获取当前光标在纯文本中的偏移
  const getCursorTextOffset = useCallback((editor: HTMLElement): number => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return 0;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length;
  }, []);

  // 内容变化后恢复光标位置
  useEffect(() => {
    if (pendingCursorRef.current === null) return;
    const editor = textareaRef.current;
    if (!editor) return;
    const offset = pendingCursorRef.current;
    pendingCursorRef.current = null;
    const range = textOffsetToRange(editor, offset);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }, [col.prompt, textOffsetToRange]);

  // 同步 col.prompt 到 contenteditable 的 innerHTML。
  // 关键：用户输入时 DOM 已是最新内容，不能再 setInnerHTML，否则会重置光标位置、
  // 导致中文 IME 输入出现重复字符。用 lastSyncedPromptRef 区分"用户输入"与"外部更新"：
  // - 用户输入：handlePromptInput 已将 ref 设为最新值，此处跳过
  // - 外部更新（清空、粘贴配置、应用预设、@提及插入）：ref 未更新，重写 innerHTML
  useEffect(() => {
    const editor = textareaRef.current;
    if (!editor) return;
    if (col.prompt === lastSyncedPromptRef.current) return;
    // 外部更新：重写 innerHTML（保留 @图片XX 主题色渲染）
    editor.innerHTML = col.prompt.replace(/@图片\d{2}/g, '<span class="mention-token">$&</span>') || '';
    lastSyncedPromptRef.current = col.prompt;
  }, [col.prompt]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const remainingSlots = 16 - col.refImages.length;
    const toProcess = imageFiles.slice(0, remainingSlots);
    if (toProcess.length === 0) return;

    let completed = 0;
    const results: string[] = [];

    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        results.push(reader.result as string);
        completed++;
        if (completed === toProcess.length) {
          onUpdate(col.id, { refImages: [...col.refImages, ...results].slice(0, 16) });
        }
      };
      reader.readAsDataURL(file);
    });
  }, [col.id, col.refImages, onUpdate]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    // 检查是否有拖入的 URL（如从暂存区拖入）
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url && !url.includes('\n') && (url.startsWith('data:') || url.startsWith('http'))) {
      const newRefs = [...col.refImages, url].slice(0, 16);
      onUpdate(col.id, { refImages: newRefs });
      return;
    }
    handleFiles(e.dataTransfer.files);
  }, [handleFiles, col.id, col.refImages, onUpdate]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  }, [handleFiles]);

  const handleCopy = useCallback(() => {
    const config = {
      name: col.name,
      model: col.model,
      aspectRatio: col.aspectRatio,
      resolution: col.resolution,
      quality: col.quality,
      prompt: col.prompt,
      refImages: col.refImages,
    };
    navigator.clipboard.writeText(JSON.stringify(config))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [col]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const config = JSON.parse(text);
      onUpdate(col.id, {
        name: config.name || col.name,
        model: config.model || col.model,
        aspectRatio: config.aspectRatio || col.aspectRatio,
        resolution: config.resolution || col.resolution,
        quality: config.quality || col.quality,
        prompt: config.prompt || '',
        refImages: Array.isArray(config.refImages) ? config.refImages : [],
      });
    } catch {
      // ignore
    }
  }, [col, onUpdate]);

  const handleClear = useCallback(() => {
    // 仅清空提示词与参考图，保留已生成结果及模型/宽高比等配置
    onUpdate(col.id, {
      prompt: '',
      refImages: [],
    });
  }, [col.id, onUpdate]);

  // ───── @ 提及参考图 ─────

  const getFilteredRefs = useCallback(() => {
    return col.refImages
      .map((img, i) => ({ img, i }))
      .filter(({ i }) => {
        if (mentionFilter) {
          return String(i).includes(mentionFilter);
        }
        return true;
      });
  }, [col.refImages, mentionFilter]);

  const selectMention = useCallback((refIndex: number) => {
    const editor = textareaRef.current;
    if (!editor) return;

    // 从 stored mentionAtPos 定位 @ 位置，删除 @+filter，插入主题色 span
    const atPos = mentionAtPos;
    if (atPos < 0) return;

    const token = '图片' + String(refIndex + 1).padStart(2, '0');
    const filterLen = mentionFilter.length;

    // 构建 DOM range：从 @ 位置到 @+filter 之后
    const startRange = textOffsetToRange(editor, atPos);
    const endRange = textOffsetToRange(editor, atPos + 1 + filterLen);
    const range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.startContainer, endRange.startOffset);
    range.deleteContents();

    // 插入带主题色的 span
    const span = document.createElement('span');
    span.className = 'mention-token';
    span.textContent = '@' + token;
    range.insertNode(span);

    // 插入空格并移动光标
    const space = document.createTextNode('\u00A0');
    range.setStartAfter(span);
    range.collapse(true);
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);

    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    editor.focus();

    setMentionActive(false);
    setMentionFilter('');
    setMentionAtPos(-1);

    // 提取纯文本更新 prompt
    const mentionText = editor.innerText || '';
    lastSyncedPromptRef.current = mentionText;
    onUpdate(col.id, { prompt: mentionText });
  }, [col.id, onUpdate, mentionAtPos, mentionFilter, textOffsetToRange]);

  const handlePromptInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const editor = e.currentTarget;
    const text = editor.innerText || '';

    // 仅光标移动（文本未变）时不处理
    if (text === col.prompt) return;

    // 获取光标在纯文本中的位置
    const cursorPos = getCursorTextOffset(editor);

    // 检测 @ 触发
    const textBeforeCursor = text.slice(0, cursorPos);
    const atPos = textBeforeCursor.lastIndexOf('@');

    if (
      atPos !== -1 &&
      (atPos === 0 || /\s/.test(textBeforeCursor[atPos - 1]))
    ) {
      const afterAt = textBeforeCursor.slice(atPos + 1);
      if (!afterAt.includes('\n')) {
        // 镜像 div 测量光标位置
        const mirror = mirrorRef.current;
        if (mirror) {
          mirror.textContent = textBeforeCursor || '\u200B';
          const range = document.createRange();
          const textNode = mirror.firstChild;
          if (textNode && textNode.textContent) {
            range.setStart(textNode, textNode.textContent.length);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            const container = editor.parentElement;
            if (container) {
              const containerRect = container.getBoundingClientRect();
              setMentionPos({
                left: rect.left - containerRect.left,
                top: rect.bottom - containerRect.top,
              });
            }
          }
        }
        setMentionActive(true);
        setMentionFilter(afterAt);
        setMentionIndex(0);
        setMentionAtPos(atPos);
      } else {
        setMentionActive(false);
        setMentionFilter('');
        setMentionAtPos(-1);
      }
    } else {
      setMentionActive(false);
      setMentionFilter('');
      setMentionAtPos(-1);
    }

    // 标记：这是用户输入触发的更新，useEffect 据此跳过 setInnerHTML，避免重置光标
    lastSyncedPromptRef.current = text;
    onUpdate(col.id, { prompt: text });
  }, [col.id, col.prompt, onUpdate, getCursorTextOffset]);

  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // 退格删除 @图片XX 主题色 span
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed === false) return;

      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;

      const node = range.startContainer;
      const offset = range.startOffset;

      // 光标在文本节点开头，检查前一个兄弟是否是 mention span
      if (node.nodeType === Node.TEXT_NODE && offset === 0 && node.previousSibling) {
        const prev = node.previousSibling;
        if (prev instanceof HTMLSpanElement && prev.classList.contains('mention-token')) {
          e.preventDefault();
          prev.remove();
          const bsText = (e.currentTarget as HTMLElement).innerText || '';
          lastSyncedPromptRef.current = bsText;
          onUpdate(col.id, { prompt: bsText });
          return;
        }
      }
      // 如果光标在一个 mention span 后面（span → textNode 序列）
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = node.previousElementSibling;
        if (prev instanceof HTMLSpanElement && prev.classList.contains('mention-token')) {
          e.preventDefault();
          prev.remove();
          const bsText2 = (e.currentTarget as HTMLElement).innerText || '';
          lastSyncedPromptRef.current = bsText2;
          onUpdate(col.id, { prompt: bsText2 });
          return;
        }
      }
      return;
    }

    if (!mentionActive) return;

    const filtered = getFilteredRefs();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      selectMention(filtered[mentionIndex]?.i ?? filtered[0].i);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionActive(false);
      setMentionFilter('');
      setMentionAtPos(-1);
    }
  }, [mentionActive, mentionIndex, getFilteredRefs, selectMention, col.id, onUpdate]);

  // ───────────────────────────

  const handleCopyImage = useCallback(async (imageUrl: string, imgId: string) => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setCopiedImageId(imgId);
      setTimeout(() => setCopiedImageId(null), 2000);
    } catch {
      window.open(imageUrl, '_blank');
    }
  }, []);

  const handleDownloadImage = useCallback(async (imageUrl: string) => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `generated_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, '_blank');
    }
  }, []);

  const handleUseAsRef = useCallback(async (imageUrl: string, imgId: string) => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        onUpdate(col.id, { refImages: [...col.refImages, reader.result as string] });
        setRefImageId(imgId);
        setTimeout(() => setRefImageId(null), 2000);
      };
      reader.readAsDataURL(blob);
    } catch {
      onUpdate(col.id, { refImages: [...col.refImages, imageUrl] });
      setRefImageId(imgId);
      setTimeout(() => setRefImageId(null), 2000);
    }
  }, [col.id, col.refImages, onUpdate]);

  const handleCopyCardConfig = useCallback((item: ResultItem) => {
    const config = { model: item.model, aspectRatio: item.aspectRatio, resolution: item.resolution, prompt: item.prompt, refImages: item.refImages };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
      .then(() => {
        setCopiedCardConfigId(item.id);
        setTimeout(() => setCopiedCardConfigId(null), 1500);
      })
      .catch(() => {});
  }, []);

  const handleApplyCardConfig = useCallback((item: ResultItem) => {
    onUpdate(col.id, { 
      model: item.model, 
      aspectRatio: item.aspectRatio, 
      resolution: item.resolution, 
      prompt: item.prompt,
      refImages: item.refImages
    });
    setAppliedCardConfigId(item.id);
    setTimeout(() => setAppliedCardConfigId(null), 1500);
  }, [col.id, onUpdate]);

  const handleRetry = useCallback((item: ResultItem) => {
    onUpdate(col.id, {
      model: item.model,
      aspectRatio: item.aspectRatio,
      resolution: item.resolution,
      prompt: item.prompt,
    });
    onGenerate(col);
  }, [col, onUpdate, onGenerate]);

  return (
    <div
      className={`relative flex-shrink-0 w-[408px] h-full overflow-visible transition-all duration-300 ease-out ${
        entered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
      data-agent-col={col.id}
      data-agent-type="column"
    >
      {/* Between-column add button */}
      {colIndex < totalCols - 1 && (
        <div className="absolute top-0 -right-5 -translate-y-1/2 group cursor-pointer z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddBetween(colIndex);
            }}
            className="w-6 h-6 rounded-full bg-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
          >
            <Plus className="w-3 h-3 text-[#86868b]" />
          </button>
        </div>
      )}
      <div className="bg-white rounded-2xl overflow-hidden flex flex-col h-full">
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={col.name}
            onChange={e => onUpdate(col.id, { name: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') setEditingName(false);
            }}
            onBlur={() => setEditingName(false)}
            className="text-[13px] font-['Inter'] font-semibold text-[#1d1d1f] bg-[#f1f5f9] rounded-lg px-2 py-1 focus:outline-none ring-2 ring-[#4f39f6]/30 w-40"
          />
        ) : (
          <span
            onClick={() => {
              setEditingName(true);
              setTimeout(() => nameInputRef.current?.focus(), 0);
            }}
            className="text-[13px] font-['Inter'] font-semibold text-[#1d1d1f] cursor-pointer hover:text-[#4f39f6] transition-colors border-b border-dashed border-transparent hover:border-[#4f39f6]/40"
          >
            {col.name}
          </span>
        )}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopy}
            title={copied ? '已复制' : '复制配置'}
            className={`transition-all active:scale-90 p-1 ${
              copied ? 'text-[#34c759]' : 'text-[#86868b] hover:text-[#4f39f6]'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handlePaste}
            title="粘贴配置"
            className="text-[#86868b] hover:text-[#4f39f6] transition-all active:scale-90 p-1"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleClear}
            title="清空配置"
            className="text-[#86868b] hover:text-[#ff9500] transition-all active:scale-90 p-1"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRequestRemove(col.id)}
            title="删除列"
            className="text-[#86868b] hover:text-[#ff3b30] transition-all active:scale-90 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={(el) => {
          scrollContainerRef.current = el;
          registerColumnScrollRef(col.id, el);
        }}
        className="p-4 pb-[50vh] flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        onScroll={() => {
          const st = scrollContainerRef.current?.scrollTop || 0;
          onColumnScroll(col.id, st);
        }}
      >
        {/* Config Area - 包含参数选择区、参考图区域和输入框 */}
        <div className="flex flex-col gap-4" data-agent-col={col.id} data-agent-type="config-area">
          {/* Config Row */}
          <div className="flex gap-2" data-agent-col={col.id} data-agent-type="config">
            <div className="w-1/2">
              <Select
                value={col.model}
                onChange={v => onUpdate(col.id, { model: v })}
                options={MODEL_OPTIONS}
              />
            </div>
            <div className="flex-1">
              <Select
                value={col.aspectRatio}
                onChange={v => onUpdate(col.id, { aspectRatio: v })}
                options={ASPECT_OPTIONS}
              />
            </div>
            <div className="flex-1">
              <Select
                value={col.resolution}
                onChange={v => onUpdate(col.id, { resolution: v })}
                options={RESOLUTION_OPTIONS}
              />
            </div>
          </div>

          {/* Reference Images */}
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onMouseDown={(e) => {
              // 用 setTimeout 将文件对话框的打开与当前事件链解耦，
              // 让 mousedown → mouseup → click 完整结束，避免 :active 粘滞和页面卡顿
              e.preventDefault();
              setTimeout(() => {
                fileInputRef.current?.click();
              }, 0);
            }}
            className={`relative rounded-xl transition-all cursor-pointer ${
              isDraggingOver
                ? 'bg-[#4f39f6]/10 ring-2 ring-[#4f39f6] ring-offset-1'
                : 'bg-[#f1f5f9] hover:bg-[#f0f0f2]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            {col.refImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 p-2.5">
                {col.refImages.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative group"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                    onMouseEnter={() => onRefPreview({ colId: col.id, url: img })}
                    onMouseLeave={() => onRefPreview(prev => prev?.colId === col.id ? null : prev)}
                    data-agent-col={col.id}
                    data-agent-type="ref-image"
                  >
                    <img
                      src={img}
                      alt={`ref-${idx}`}
                      data-agent-image-url={img}
                      className="w-12 h-12 object-cover rounded-lg"
                    />
                    <button
                      onClick={() => { onRemoveRef(col.id, idx); onRefPreview(null); }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#ff3b30] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {col.refImages.length < 16 && (
                  <div className="w-12 h-12 bg-[#e5e5e7]/50 rounded-lg flex items-center justify-center">
                    <Plus className="w-4 h-4 text-[#d1d1d6]" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4">
                <Upload className="w-5 h-5 text-[#c7c7cc] mb-1" />
                <span className="text-[10px] text-[#c7c7cc] font-semibold">拖拽图片 或 点击上传</span>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="relative">
            {/* 参考图预览覆盖层（悬浮参考图缩略图时显示） */}
            {refPreview?.colId === col.id && (
              <div className="absolute inset-0 pointer-events-none z-10 bg-white/40 backdrop-blur-xl">
                <img
                  src={refPreview.url}
                  alt="preview"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            {/* 镜像 div — 用于测量光标像素位置，样式与编辑区一致 */}
            <div
              ref={mirrorRef}
              className="absolute invisible whitespace-pre-wrap break-words pointer-events-none"
              style={{
                fontFamily: 'serif',
                fontWeight: 'bold',
                fontSize: '14px',
                lineHeight: '1.5',
                padding: '10px 12px',
                left: 0,
                top: 0,
                width: '100%',
                maxWidth: '100%',
              }}
            />
            {/* contenteditable 编辑区 — 支持 @图片XX 主题色渲染 */}
            <style>{`
              .mention-token {
                color: #4f39f6;
                font-weight: 700;
              }
              .prompt-editor:empty::before {
                content: attr(data-placeholder);
                color: #c7c7cc;
                pointer-events: none;
              }
            `}</style>
            <div
              ref={textareaRef}
              className="prompt-editor w-full bg-[#f1f5f9] focus:outline-none rounded-xl px-3 py-2.5 text-[14px] text-[#1d1d1f] font-serif font-bold h-[300px] overflow-y-auto whitespace-pre-wrap break-words [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              data-agent-col={col.id}
              data-agent-type="prompt"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="描述画面中的主体、细节、色彩、在何处发生... 输入 @ 引用参考图"
              onInput={handlePromptInput}
              onKeyDown={handlePromptKeyDown}
            />
            {/* @ 提及下拉列表 — 定位在光标下方 */}
            {mentionActive && (() => {
              if (col.refImages.length === 0) {
                return (
                  <div
                    className="absolute bg-white rounded-xl border border-[#e5e5e7] z-50 px-4 py-3 text-center"
                    style={{ left: '50%', top: mentionPos.top, transform: 'translateX(-50%)', width: 'calc(100% - 24px)' }}
                  >
                    <span className="text-[12px] text-[#a1a1a6]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>暂未上传参考图，请先在上方添加参考图片</span>
                  </div>
                );
              }
              const filtered = getFilteredRefs();
              if (filtered.length === 0) return null;
              return (
                <div
                  className="absolute bg-white rounded-xl border border-[#e5e5e7] z-50 max-h-[160px] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                  style={{ left: '50%', top: mentionPos.top, transform: 'translateX(-50%)', width: 'calc(100% - 24px)' }}
                >
                  {filtered.map(({ img, i }, fi) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 px-3 py-[5px] cursor-pointer transition-colors ${
                        fi === mentionIndex ? 'bg-[#4f39f6]/10' : 'hover:bg-[#f1f5f9]'
                      }`}
                      onMouseDown={e => {
                        e.preventDefault();
                        selectMention(i);
                      }}
                      onMouseEnter={() => setMentionIndex(fi)}
                    >
                      <img src={img} alt={`ref-${i}`} className="w-6 h-6 object-cover rounded-md flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-[#1d1d1f]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>参考图 #{i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Generate Button */}
            <button
              data-agent-generate={col.id}
              onClick={() => {
                onGenerate(col);
              }}
              disabled={col.isGenerating}
              className="absolute bottom-3 right-2.5 w-8 h-8 bg-[#4f39f6] hover:bg-[#4338ca] rounded-full flex items-center justify-center text-white transition-all"
            >
              {col.isGenerating ? (
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>
          </div>
        </div>

        {/* 占位填充 — 无结果且非生成中时撑开 */}
        {!col.isGenerating && col.results.length === 0 && (
          <div className="flex-1" />
        )}

        {/* Results Header — 筛选栏（生成中或有结果时显示） */}
        {(col.isGenerating || col.results.length > 0) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1 bg-[#f1f5f9] rounded-md p-0.5">
              <button
                onClick={() => setGalleryFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-['Inter'] font-semibold transition-colors ${
                  galleryFilter === 'all'
                    ? 'bg-white text-[#4f39f6]'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setGalleryFilter('selected')}
                className={`px-2 py-0.5 rounded text-[10px] font-['Inter'] font-semibold transition-colors ${
                  galleryFilter === 'selected'
                    ? 'bg-white text-[#4f39f6]'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                备选
              </button>
              <button
                onClick={() => setGalleryFilter('downloaded')}
                className={`px-2 py-0.5 rounded text-[10px] font-['Inter'] font-semibold transition-colors ${
                  galleryFilter === 'downloaded'
                    ? 'bg-white text-[#4f39f6]'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                已下载
              </button>
            </div>
            {col.results.some(r => r.errorMessage) && (
              <button
                onClick={() => {
                  onUpdate(col.id, {
                    results: col.results.filter(r => !r.errorMessage),
                  });
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[#ff3b30] hover:bg-[#fee2e2] transition-colors"
                title="清除所有报错卡片"
              >
                <Trash2 className="w-3 h-3" />
                <span>清除报错</span>
              </button>
            )}
          </div>
        )}

        {/* Results — 最新的在输入框正下。
            统一按 item 状态分三种渲染：有 imageUrl → 成功卡片；
            有 errorMessage → 错误卡片；都没有 → 生成中。 */}
        {col.results.map((item, idx) => {
          const imgId = item.id;
          const displayUrl = imageUrls[imgId] || imgId;
          const ts = item.timestamp;
          const timeStr = ts ? formatTimeAgo(ts) : '';
          const duration = item.duration;
          const isSelected = col.selected.has(imgId);
          const isDownloaded = col.downloaded.has(imgId);
          const isGenerating = !item.imageUrl && !item.errorMessage;
          const isError = !!item.errorMessage;
          const isSuccess = !!item.imageUrl;

          if (galleryFilter === 'selected' && !isSelected) return null;
          if (galleryFilter === 'downloaded' && !isDownloaded) return null;

          return (
            <div key={idx} className="relative flex-shrink-0 bg-[#f1f5f9] rounded-xl overflow-hidden flex flex-col" data-agent-col={col.id} data-agent-type="result-image" data-agent-item={imgId}>
              {/* Top Bar — 共用 */}
              <div className="px-3 py-3 flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <span className={`text-[12px] font-['Inter'] font-medium flex-shrink-0 ${
                  isGenerating ? 'text-[#4f39f6]' : 'text-[#4f39f6]'
                }`}>{item.resolution}</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isGenerating ? 'bg-[#4f39f6] animate-pulse' : 'bg-[#248a3d]'
                }`} />
                <span className="text-[10px] font-medium text-[#1d1d1f] px-1.5 py-0.5 bg-white rounded leading-none inline-flex items-center min-w-0 overflow-hidden text-ellipsis">{item.model}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-white rounded text-[#1d1d1f] leading-none inline-flex items-center">{item.aspectRatio}</span>
                <span className="text-[10px] font-['Inter'] font-semibold px-1.5 py-0.5 bg-white rounded text-[#1d1d1f] leading-none inline-flex items-center">参考({col.refImages.length})</span>
                <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                  {isGenerating ? (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyCardConfig(item); }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-[#e2e8f0] text-[#1d1d1f] hover:text-[#4f39f6] active:scale-95 active:bg-[#cbd5e1] transition-all ${copiedCardConfigId === item.id ? 'text-[#34c759]' : ''}`}
                        title="复制配置"
                      >
                        {copiedCardConfigId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span className="text-[10px] font-['Inter'] font-semibold">{copiedCardConfigId === item.id ? '已复制' : '复制配置'}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApplyCardConfig(item); }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-[#e2e8f0] text-[#1d1d1f] hover:text-[#4f39f6] active:scale-95 active:bg-[#cbd5e1] transition-all ${appliedCardConfigId === item.id ? 'text-[#34c759]' : ''}`}
                        title="应用配置"
                      >
                        {appliedCardConfigId === item.id ? <Check className="w-3 h-3" /> : <ClipboardPaste className="w-3 h-3" />}
                        <span className="text-[10px] font-['Inter'] font-semibold">{appliedCardConfigId === item.id ? '已应用' : '应用配置'}</span>
                      </button>
                    </>
                  ) : isError ? (
                    <></>
                  ) : (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyCardConfig(item); }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-[#e2e8f0] text-[#1d1d1f] hover:text-[#4f39f6] active:scale-95 active:bg-[#cbd5e1] transition-all ${copiedCardConfigId === item.id ? 'text-[#34c759]' : ''}`}
                        title="复制配置"
                      >
                        {copiedCardConfigId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span className="text-[10px] font-['Inter'] font-semibold">{copiedCardConfigId === item.id ? '已复制' : '复制配置'}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApplyCardConfig(item); }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-[#e2e8f0] text-[#1d1d1f] hover:text-[#4f39f6] active:scale-95 active:bg-[#cbd5e1] transition-all ${appliedCardConfigId === item.id ? 'text-[#34c759]' : ''}`}
                        title="应用配置"
                      >
                        {appliedCardConfigId === item.id ? <Check className="w-3 h-3" /> : <ClipboardPaste className="w-3 h-3" />}
                        <span className="text-[10px] font-['Inter'] font-semibold">{appliedCardConfigId === item.id ? '已应用' : '应用配置'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Image Area — 按状态切换 */}
              <div className="overflow-hidden relative group">
                {isGenerating ? (
                  <>
                    <div className="w-full bg-gradient-to-b from-[#e2e8f0] via-[#f1f5f9] to-[#e2e8f0] animate-pulse relative overflow-hidden" style={{ aspectRatio: ratio }}>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#4f39f6]/15 to-transparent animate-shimmer" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="px-3 py-1.5 rounded-full bg-black/20 text-white text-[16px] font-semibold font-['Inter'] backdrop-blur-sm">
                          {formatDuration(timers[imgId] || 0)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => onAbort(item.id, col.id)}
                      className="absolute bottom-2 right-2 z-10 px-2 py-1 rounded-md bg-white text-black hover:bg-[#ff3b30] hover:text-white flex items-center gap-1 transition-colors transform scale-80"
                      title="中断生成"
                    >
                      <X className="w-3 h-3" />
                      <span className="text-[11px] font-medium">中断</span>
                    </button>
                  </>
                ) : isError ? (
                    <div className="relative bg-[#fff1f2] flex flex-col items-center justify-center p-6" style={{ aspectRatio: ratio }}>
                      <div className="flex items-center gap-1.5 text-[#ff3b30] text-[12px] font-semibold mb-3 font-['Inter']">
                        <div className="w-4 h-4 rounded-full bg-[#ff3b30] text-white flex items-center justify-center flex-shrink-0">
                          <X className="w-2.5 h-2.5" />
                        </div>
                        <span>生成进程发生阻断</span>
                      </div>
                      <div className="text-[#ff3b30] text-[10px] text-center mb-4 max-w-full px-2 break-words leading-relaxed font-['Inter']">{item.errorMessage}</div>
                      <button
                        onClick={() => handleRetry(item)}
                        className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-[#ff3b30] text-white hover:bg-[#d93026] transition-colors"
                        title="重新尝试生成"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span className="text-[11px] font-medium">重新尝试生成</span>
                      </button>
                    </div>
                ) : (
                  <>
                    <img
                      src={displayUrl}
                      alt="result"
                      data-agent-image-url={item.imageUrl || ''}
                      className="w-full h-auto object-contain cursor-pointer transition-transform duration-300 group-hover:scale-[1.05]"
                      onClick={() => setIsFullscreen(displayUrl)}
                    />
                    {isDownloaded && (
                      <div className="absolute top-2 left-2 z-10 text-[#248a3d] px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" />
                        <span className="font-['Inter'] font-semibold">已下载</span>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const newSelected = new Set(col.selected);
                        if (newSelected.has(imgId)) newSelected.delete(imgId);
                        else newSelected.add(imgId);
                        onUpdate(col.id, { selected: newSelected });
                      }}
                      className={`absolute top-2 right-2 p-1.5 rounded-full transition-all z-10 ${
                        isSelected
                          ? 'bg-black/40 text-[#ffcc00] opacity-100'
                          : 'bg-black/40 text-white hover:bg-black/60 opacity-0 group-hover:opacity-100'
                      }`}
                      title={isSelected ? '取消备选' : '设为备选'}
                    >
                      <Star className={`w-3.5 h-3.5 ${isSelected ? 'fill-current' : ''}`} />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 flex divide-x divide-white/20 bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopyImage(displayUrl, imgId)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                        title="复制图片"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span className={copiedImageId === imgId ? 'text-[#34c759]' : ''}>{copiedImageId === imgId ? '已复制' : '复制'}</span>
                      </button>
                      <button
                        onClick={() => {
                          handleDownloadImage(displayUrl);
                          const newDownloaded = new Set(col.downloaded);
                          newDownloaded.add(imgId);
                          onUpdate(col.id, { downloaded: newDownloaded });
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                        title="下载"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>下载</span>
                      </button>
                      <button
                        onClick={() => handleUseAsRef(displayUrl, imgId)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                        title="作为参考"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span className={refImageId === imgId ? 'text-[#34c759]' : ''}>{refImageId === imgId ? '已添加' : '作为参考'}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Prompt + 复制/删除 — 共用 */}
              <div className={`px-3 ${isGenerating ? 'py-2' : 'pt-4 pb-1'} flex-shrink-0 ${isGenerating ? 'bg-white/80' : 'bg-[#f1f5f9]'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-[#1d1d1f] line-clamp-2 leading-relaxed font-semibold flex-1">
                    {item.prompt}
                  </p>
                  {isGenerating ? (
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <span className="p-1 rounded-md text-[#d1d1d6]">
                        <Copy className="w-3 h-3" />
                      </span>
                      <span className="p-1 rounded-md text-[#d1d1d6]">
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </div>
                  ) : isError ? null : (
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.prompt)
                            .then(() => {
                              setCopiedPromptId(item.id);
                              setTimeout(() => setCopiedPromptId(null), 1500);
                            })
                            .catch(() => {});
                        }}
                        className={`p-1 rounded-md hover:bg-[#e5e5e7] text-[#86868b] hover:text-[#4f39f6] active:scale-90 active:bg-[#d4d4d8] transition-all ${copiedPromptId === item.id ? 'text-[#34c759]' : ''}`}
                        title="复制提示词"
                      >
                        {copiedPromptId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Bar — 时间/耗时/删除 — 共用 */}
              <div className={`px-3 py-1.5 flex-shrink-0 flex items-center justify-between ${isGenerating ? 'bg-white/60' : 'bg-[#f1f5f9]'}`}>
                <div className="flex items-center space-x-3">
                  <span className="text-[10px] text-[#a1a1a6]">
                    {ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                  </span>
                  {!isGenerating && duration > 0 && (
                    <span className={`text-[10px] font-['Inter'] font-semibold text-[#248a3d]`}>
                      • {duration}秒完成
                    </span>
                  )}
                </div>
                {!isGenerating && (
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => setPendingDeleteImgId(imgId)}
                      className="p-1 rounded-md hover:bg-[#fee2e2] text-[#86868b] hover:text-[#ff3b30] transition-colors"
                      title="删除此项"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* 删除确认对话框 — 共用 */}
              {pendingDeleteImgId === imgId && (
                <div
                  className="absolute inset-0 z-10 bg-black/40 backdrop-blur-sm flex items-center justify-center"
                  onClick={() => setPendingDeleteImgId(null)}
                >
                  <div
                    className="bg-white rounded-2xl p-6 w-[260px] flex flex-col items-center"
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-[14px] text-[#1d1d1f] mb-6 text-center">确定要删除这张图片吗？</p>
                    <div className="flex justify-center space-x-3">
                      <button
                        onClick={() => setPendingDeleteImgId(null)}
                        className="px-4 py-2 rounded-lg text-[13px] text-[#86868b] bg-[#f1f5f9] hover:bg-[#e5e5e7] transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => {
                          onUpdate(col.id, {
                            results: col.results.filter(r => r.id !== item.id),
                          });
                          setPendingDeleteImgId(null);
                        }}
                        className="px-4 py-2 rounded-lg text-[13px] text-white bg-[#ff3b30] hover:bg-[#e03530] transition-colors"
                      >
                        确定
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Logs */}
        {/* 日志面板已移除 */}

        {/* 占位填充 — 无结果且非生成中时撑开 */}
      </div>

      {/* Fullscreen Modal — 使用 Portal 脱离 transform 容器 */}
      {isFullscreen && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-white/40 backdrop-blur-xl flex items-center justify-center overflow-hidden"
          onClick={() => {
            if (hasDragged.current) { hasDragged.current = false; return; }
            setIsFullscreen(null); setZoom(1); setPan({ x: 0, y: 0 });
          }}
        >
          <img
            src={isFullscreen}
            alt="result fullscreen"
            className={`max-w-[90vw] max-h-[90vh] object-contain select-none ${dragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            draggable={false}
            onWheel={e => {
              e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setZoom(z => Math.max(0.5, Math.min(5, z + delta)));
            }}
            onMouseDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              isPanning.current = true;
              setDragging(true);
              panStart.current = { x: e.clientX - panOffset.current.x, y: e.clientY - panOffset.current.y };
            }}
            onMouseMove={e => {
              if (!isPanning.current) return;
              hasDragged.current = true;
              panOffset.current = { x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y };
              setPan(panOffset.current);
            }}
            onMouseUp={() => { isPanning.current = false; setDragging(false); }}
            onMouseLeave={() => { isPanning.current = false; setDragging(false); }}
          />
        </div>,
        document.body
      )}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#f1f5f9] rounded-lg px-2 py-1.5 text-[11px] text-[#1d1d1f] focus:outline-none"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
