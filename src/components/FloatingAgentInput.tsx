import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import {
  callAgent,
  runIntentPlanner,
  runPromptArchitect,
  runResultReviewer,
  runVisualAnalyst,
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  PromptDraft,
  ResultReview,
  VisualAnalysis,
} from '../services/agentService';
import { useAgentActions } from '../services/AgentContext';
import { addLogRound } from '../services/agentLogStore';

/** IndexedDB 存储，用于缓存压缩后的图片 data URL */
const DB_NAME = 'agent-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key: string, data: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGet(key: string): Promise<string | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** 压缩图片使 data URL 不超过指定大小，优先保留原图质量 */
async function compressImage(url: string, targetBytes: number): Promise<string> {
  // data URL 且已经够小，直接返回
  if (url.startsWith('data:') && url.length < targetBytes) return url;

  // HTTP URL 先走代理转成 blob URL，绕过 CORS
  let imageSrc = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const params = new URLSearchParams({ url });
      params.set('referer', window.location.origin);
      params.set('ua', navigator.userAgent);
      const res = await fetch(`/api/proxy-image?${params}`);
      if (res.ok) {
        const blob = await res.blob();
        imageSrc = URL.createObjectURL(blob);
      }
    } catch { /* fallback to original url */ }
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 如果是 blob URL，用完释放
      const cleanup = imageSrc.startsWith('blob:') ? () => URL.revokeObjectURL(imageSrc) : () => {};
      let w = img.width, h = img.height;
      let quality = 0.92;
      let maxSize = Math.max(w, h);

      const attempt = (): string => {
        let tw = w, th = h;
        if (Math.max(tw, th) > maxSize) {
          const ratio = maxSize / Math.max(tw, th);
          tw = Math.round(tw * ratio);
          th = Math.round(th * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) return url;
        ctx.drawImage(img, 0, 0, tw, th);
        return canvas.toDataURL('image/jpeg', quality);
      };

      let dataUrl = attempt();
      while (dataUrl.length > targetBytes && (quality > 0.2 || maxSize > 800)) {
        if (quality > 0.2) {
          quality = Math.max(0.2, quality - 0.15);
        } else {
          maxSize = Math.floor(maxSize * 0.7);
          quality = 0.8;
        }
        dataUrl = attempt();
      }
      cleanup();
      resolve(dataUrl);
    };
    img.onerror = () => resolve(url);
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;
  });
}

/** 视觉分析缓存，key 为图片 URL，value 为分析结果 */
const visualAnalysisCache = new Map<string, VisualAnalysis>();

/** 检查缓存是否有指定图片的分析结果 */
function getCachedVisualAnalysis(url: string): VisualAnalysis | undefined {
  return visualAnalysisCache.get(url);
}

/** 将分析结果存入缓存 */
function setCachedVisualAnalysis(url: string, analysis: VisualAnalysis): void {
  visualAnalysisCache.set(url, analysis);
}

export default function FloatingAgentInput() {
  const actions = useAgentActions();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [openPosition, setOpenPosition] = useState({ x: 0, y: 0 });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('agent_qwen_api_key') || '');
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem('agent_messages') || '[]'); }
    catch { return []; }
  });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [focusContexts, setFocusContexts] = useState<{ colId: string; type: string; itemId?: string; imageUrl?: string }[]>([]);
  const [focusedElements, setFocusedElements] = useState<Set<HTMLElement>>(new Set());
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const stopControllerRef = useRef<AbortController | null>(null);
  const toolImageRef = useRef<string | undefined>(undefined);
  const goalRef = useRef<string>('');

  const hasReplies = messages.length > 0 || isLoading;

  const buildPageSnapshot = useCallback((focusNote?: string) => {
    const cols = actions.getColumns();
    const columns = cols.map((c, i) => {
      const success = c.results.filter(r => r.imageUrl).length;
      const failed = c.results.filter(r => r.errorMessage).length;
      const generating = c.results.filter(r => !r.imageUrl && !r.errorMessage).length;
      const sampleResults = c.results.slice(-3).map((r, idx) => ({
        index: c.results.length - Math.min(3, c.results.length) + idx,
        hasImage: Boolean(r.imageUrl),
        hasError: Boolean(r.errorMessage),
        favorited: r.favorited,
        prompt: r.prompt?.slice(0, 120) || '',
        errorMessage: r.errorMessage || '',
      }));
      return {
        index: i,
        name: c.name,
        model: c.model,
        aspectRatio: c.aspectRatio,
        resolution: c.resolution,
        quality: c.quality,
        prompt: c.prompt,
        refImageCount: c.refImages.length,
        resultCount: c.resultCount,
        success,
        failed,
        generating,
        isGenerating: c.isGenerating,
        recentResults: sampleResults,
      };
    });

    const gallery = actions.getGalleryImages();
    const galleryImages = gallery.map((item, i) => ({
      index: i,
      name: item.name,
      origin: item.origin || '',
    }));

    return JSON.stringify({
      page: actions.getPage(),
      focus: focusNote || '',
      columns,
      galleryImages,
    }, null, 2);
  }, [actions]);

  const buildInternalAgentNotes = useCallback((
    plan?: AgentPlan,
    visualAnalysis?: VisualAnalysis,
    promptDraft?: PromptDraft,
    resultReview?: ResultReview,
    errors: string[] = [],
  ) => {
    return `[内部子 Agent 分析]\n${JSON.stringify({
      architecture: 'Orchestrator 主 Agent 负责最终决策和工具调用；子 Agent 只提供结构化建议，不能直接操作页面。',
      intentPlanner: plan,
      visualAnalyst: visualAnalysis,
      promptArchitect: promptDraft,
      resultReviewer: resultReview,
      subAgentErrors: errors,
    }, null, 2)}`;
  }, []);

  const prepareSubAgentContext = useCallback(async (
    apiKeyValue: string,
    text: string,
    focusNote: string,
    imageUrl?: string,
    imageUrls?: string[],
    signal?: AbortSignal,
    onStatus?: (status: string) => void,
  ) => {
    const pageSnapshot = buildPageSnapshot(focusNote);
    const errors: string[] = [];
    let plan: AgentPlan | undefined;
    let visualAnalysis: VisualAnalysis | undefined;
    let promptDraft: PromptDraft | undefined;

    // 有图片时先分析图片（优先检查缓存），再意图规划
    const hasImages = !!(imageUrl || (imageUrls && imageUrls.length > 0));
    if (hasImages) {
      // 如果只有一张图且缓存命中，直接使用缓存结果
      const singleUrl = imageUrl || (imageUrls?.length === 1 ? imageUrls[0] : undefined);
      const cached = singleUrl ? getCachedVisualAnalysis(singleUrl) : undefined;
      if (cached) {
        visualAnalysis = cached;
      } else {
        onStatus?.('我先看下这张图…');
        try {
          visualAnalysis = await runVisualAnalyst(apiKeyValue, text, pageSnapshot, imageUrl, imageUrls, signal);
          // 分析成功后存入缓存
          if (visualAnalysis && singleUrl) {
            setCachedVisualAnalysis(singleUrl, visualAnalysis);
          }
        } catch (err: any) {
          errors.push(`VisualAnalyst: ${err.message}`);
        }
      }
    }
    if (signal?.aborted) return { pageSnapshot, notes: buildInternalAgentNotes(plan, visualAnalysis, promptDraft, undefined, errors), plan };

    onStatus?.('我想想怎么做…');
    try {
      // 把图片分析结果传给意图规划器，辅助判断
      const planContext = visualAnalysis
        ? `[图片分析]\n${JSON.stringify(visualAnalysis, null, 2)}\n\n${pageSnapshot}`
        : pageSnapshot;
      plan = await runIntentPlanner(apiKeyValue, text, planContext, signal);
    } catch (err: any) {
      errors.push(`IntentPlanner: ${err.message}`);
    }
    if (signal?.aborted) return { pageSnapshot, notes: buildInternalAgentNotes(plan, visualAnalysis, promptDraft, undefined, errors), plan };

    // 没有图片时走原逻辑：意图规划后再判断是否需要看图
    if (!hasImages) {
      const shouldAnalyzeImage = Boolean(
        plan?.needsVisualAnalysis ||
        /参考图|这张图|图片|画面|风格|像这/i.test(text),
      );
      if (shouldAnalyzeImage) {
        const singleUrl = imageUrl || (imageUrls?.length === 1 ? imageUrls[0] : undefined);
        const cached = singleUrl ? getCachedVisualAnalysis(singleUrl) : undefined;
        if (cached) {
          visualAnalysis = cached;
        } else {
          onStatus?.('我来看看这张图…');
          try {
            visualAnalysis = await runVisualAnalyst(apiKeyValue, text, pageSnapshot, imageUrl, imageUrls, signal);
            if (visualAnalysis && singleUrl) {
              setCachedVisualAnalysis(singleUrl, visualAnalysis);
            }
          } catch (err: any) {
            errors.push(`VisualAnalyst: ${err.message}`);
          }
        }
      }
    }
    if (signal?.aborted) return { pageSnapshot, notes: buildInternalAgentNotes(plan, visualAnalysis, promptDraft, undefined, errors), plan };

    const shouldDraftPrompt = Boolean(
      plan?.needsPromptWriting ||
      plan?.needsGeneration ||
      /prompt|提示词|优化|改写|扩写|生成|出图|生图/i.test(text),
    );
    if (shouldDraftPrompt) {
      onStatus?.('我想想提示词怎么优化…');
      try {
        promptDraft = await runPromptArchitect(apiKeyValue, text, pageSnapshot, plan, visualAnalysis, signal);
      } catch (err: any) {
        errors.push(`PromptArchitect: ${err.message}`);
      }
    }

    return {
      pageSnapshot,
      notes: buildInternalAgentNotes(plan, visualAnalysis, promptDraft, undefined, errors),
      plan,
    };
  }, [buildInternalAgentNotes, buildPageSnapshot]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: openPosition.x,
      origY: openPosition.y,
      moved: false,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
      setOpenPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };
    const onUp = () => {
      // 延迟清空，让 click 事件能读到 moved 状态
      setTimeout(() => { dragRef.current = null; }, 0);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [openPosition]);

  // 工具消息点击展开（仅非拖拽时触发）
  const handleToolClick = useCallback((idx: number, e: React.MouseEvent) => {
    // 拖拽刚结束（moved=true）则不触发展开
    if (dragRef.current?.moved) return;
    e.stopPropagation();
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setPosition({ x: e.clientX + 16, y: e.clientY + 16 });
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const pos = { x: e.clientX + 16, y: e.clientY + 16 };
    const tooltipHeight = tooltipRef.current?.offsetHeight || 0;
    const isCtrlPressed = e.ctrlKey || e.metaKey;
    setPosition(pos);
    setOpenPosition({ x: pos.x, y: pos.y + tooltipHeight });
    setIsOpen(true);

    if (!isCtrlPressed) {
      setMessages([]);
      setFocusedElements(new Set());
      setFocusContexts([]);
      focusedElementRef.current = null;
    }

    let el: HTMLElement | null = e.target as HTMLElement;
    let found = false;
    let focusColId: string | null = null;
    let focusType: string | null = null;
    let focusItemId: string | undefined;
    let focusImageUrl: string | undefined;
    let columnEl: HTMLElement | null = null;

    while (el && !found) {
      const colId = el.getAttribute?.('data-agent-col');
      const type = el.getAttribute?.('data-agent-type');

      if (type === 'gallery-image') {
        const img = el.querySelector<HTMLImageElement>('img[data-agent-image-url]');
        const imgUrl = img?.getAttribute('data-agent-image-url') || undefined;
        if (imgUrl) {
          focusImageUrl = imgUrl;
        }
        focusType = type;
        focusItemId = el.getAttribute?.('data-agent-item') || undefined;
        columnEl = el;
        found = true;
        break;
      }

      if (colId && type) {
        focusColId = colId;
        focusType = type;
        focusItemId = el.getAttribute?.('data-agent-item') || undefined;

        if (type === 'result-image' || type === 'ref-image') {
          const img = el.querySelector<HTMLImageElement>('img[data-agent-image-url]');
          if (img) {
            focusImageUrl = img.getAttribute('data-agent-image-url') || undefined;
          }
        }

        if (type === 'prompt' || type === 'config' || type === 'ref-image') {
          let parent = el.parentElement;
          while (parent) {
            const parentColId = parent.getAttribute?.('data-agent-col');
            const parentType = parent.getAttribute?.('data-agent-type');
            if (parentColId === colId && parentType === 'config-area') {
              columnEl = parent;
              break;
            }
            parent = parent.parentElement;
          }
        } else {
          columnEl = el;
        }

        found = true;
      }
      el = el.parentElement;
    }

    if (columnEl) {
      if (isCtrlPressed) {
        setFocusedElements(prev => {
          const next = new Set(prev);
          if (next.has(columnEl)) {
            next.delete(columnEl);
          } else {
            next.add(columnEl);
          }
          return next;
        });
        setFocusContexts(prev => {
          const existingIndex = prev.findIndex(ctx => 
            ctx.colId === focusColId && ctx.type === focusType && ctx.itemId === focusItemId
          );
          if (existingIndex >= 0) {
            return prev.filter((_, i) => i !== existingIndex);
          }
          return [...prev, { colId: focusColId || '__gallery__', type: focusType || '', itemId: focusItemId, imageUrl: focusImageUrl }];
        });
      } else {
        focusedElementRef.current = columnEl;
        setFocusedElements(new Set([columnEl]));
        setFocusContexts([{ colId: focusColId || '__gallery__', type: focusType || '', itemId: focusItemId, imageUrl: focusImageUrl }]);
      }
    }

    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setMessages([]);
    setFocusContexts([]);
    goalRef.current = '';
    try { localStorage.removeItem('agent_messages'); } catch {}
    setFocusedElements(new Set());
    focusedElementRef.current = null;
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [handleMouseMove, handleContextMenu]);

  useEffect(() => {
    const focusedSet = new Set(focusedElements);
    document.querySelectorAll('.focus-ring-flow').forEach(el => {
      if (!focusedSet.has(el)) {
        el.classList.remove('focus-ring-flow');
      }
    });
    focusedElements.forEach(el => {
      el.classList.add('focus-ring-flow');
    });
  }, [focusedElements]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (e.button === 2) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleClose]);

  // 自动保存消息到 localStorage（最多保留 50 条）
  useEffect(() => {
    try {
      const toSave = messages.length > 50 ? messages.slice(-50) : messages;
      localStorage.setItem('agent_messages', JSON.stringify(toSave));
    } catch { /* localStorage 满时静默失败 */ }
  }, [messages]);

  /** 执行工具调用 */
  const executeToolCall = useCallback(async (toolCall: AgentToolCall, msgs: AgentMessage[]): Promise<string> => {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const name = toolCall.function.name;

    const getUserIntent = () => {
      const userMsgs = msgs.filter(m => m.role === 'user');
      if (userMsgs.length === 0) return '';
      const lastUserMsg = userMsgs[userMsgs.length - 1];
      return lastUserMsg.content || '';
    };

    switch (name) {
      case 'create_column': {
        actions.addColumn();
        const cols = actions.getColumns();
        return `已创建第 ${cols.length} 个生图列`;
      }
      case 'delete_column': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.removeColumn(cols[idx].id);
          return `已删除第 ${idx + 1} 列`;
        }
        return `列索引 ${idx} 无效，当前共 ${cols.length} 列`;
      }
      case 'set_prompt': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { prompt: args.prompt });
          return `已设置第 ${idx + 1} 列提示词`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'set_model': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { model: args.model });
          return `已设置第 ${idx + 1} 列模型为 ${args.model}`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'set_aspect_ratio': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { aspectRatio: args.aspectRatio });
          return `已设置第 ${idx + 1} 列宽高比为 ${args.aspectRatio}`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'set_resolution': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { resolution: args.resolution });
          return `已设置第 ${idx + 1} 列分辨率为 ${args.resolution}`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'set_column_name': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { name: args.name });
          return `已设置第 ${idx + 1} 列名称为 ${args.name}`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'set_quality': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { quality: args.quality });
          return `已设置第 ${idx + 1} 列质量为 ${args.quality}`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'generate_image': {
        const cols = actions.getColumns();
        const idx = args.columnIndex ?? 0;

        // 记录触发前各列的结果状态快照：对已有 ID 区分 pending / completed
        const beforeState = new Map<string, { id: string; pending: boolean }[]>();
        const targetCols: { id: string; index: number }[] = [];

        if (idx === -1) {
          for (let i = 0; i < cols.length; i++) {
            beforeState.set(cols[i].id, cols[i].results.map(r => ({ id: r.id, pending: !r.imageUrl && !r.errorMessage })));
            targetCols.push({ id: cols[i].id, index: i });
            if (args.prompt) {
              actions.updateColumn(cols[i].id, { prompt: args.prompt });
            }
          }
        } else if (idx >= 0 && idx < cols.length) {
          beforeState.set(cols[idx].id, cols[idx].results.map(r => ({ id: r.id, pending: !r.imageUrl && !r.errorMessage })));
          targetCols.push({ id: cols[idx].id, index: idx });
          if (args.prompt) {
            actions.updateColumn(cols[idx].id, { prompt: args.prompt });
          }
        } else {
          return `列索引 ${idx} 无效，当前共 ${cols.length} 列`;
        }

        // 等一帧让 React 更新 col prop，再点击生成按钮
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        for (const tc of targetCols) {
          const btn = document.querySelector(`[data-agent-generate="${tc.id}"]`) as HTMLButtonElement | null;
          if (btn) {
            if (btn.disabled) continue; // 跳过已在生成中的列
            btn.click();
          }
        }

        // 轮询等待生成结果（最多 90 秒，每 1.5 秒检查一次）
        const maxWait = 90000;
        const pollInterval = 1500;
        let waited = 0;
        let allDone = false;

        while (waited < maxWait && !allDone) {
          await new Promise(r => setTimeout(r, pollInterval));
          waited += pollInterval;
          const current = actions.getColumns();
          allDone = true;
          for (const tc of targetCols) {
            const col = current.find(c => c.id === tc.id);
            if (!col) continue;
            const before = beforeState.get(tc.id) || [];
            const beforeIds = new Set(before.map(b => b.id));

            // 检查新出现的 ID
            const newItems = col.results.filter(r => !beforeIds.has(r.id));
            const pendingNew = newItems.filter(r => !r.imageUrl && !r.errorMessage);

            // 检查已有 pending 项是否完成
            const hadPending = before.filter(b => b.pending).map(b => b.id);
            const stillPending = col.results.filter(r => hadPending.includes(r.id) && !r.imageUrl && !r.errorMessage);

            if (pendingNew.length > 0 || stillPending.length > 0) {
              allDone = false;
            }
          }
          // 如果所有列都不在生成中状态，提前退出
          const anyGenerating = current.some(c => c.isGenerating);
          if (!anyGenerating) break;
        }

        // 汇总结果
        const final = actions.getColumns();
        const lines: string[] = [];
        for (const tc of targetCols) {
          const col = final.find(c => c.id === tc.id);
          if (!col) continue;
          const before = beforeState.get(tc.id) || [];
          const beforeIds = new Set(before.map(b => b.id));
          const hadPendingIds = new Set(before.filter(b => b.pending).map(b => b.id));

          // 新出现的 ID
          const newItems = col.results.filter(r => !beforeIds.has(r.id));
          // 之前 pending 现在完成的 ID
          const completedIds = col.results.filter(r => hadPendingIds.has(r.id) && (r.imageUrl || r.errorMessage));
          // 之前 pending 现在仍然 pending
          const stillPending = col.results.filter(r => hadPendingIds.has(r.id) && !r.imageUrl && !r.errorMessage);

          const success = newItems.filter(r => r.imageUrl).length + completedIds.filter(r => r.imageUrl).length;
          const failed = newItems.filter(r => r.errorMessage).length + completedIds.filter(r => r.errorMessage).length;
          const pending = newItems.filter(r => !r.imageUrl && !r.errorMessage).length + stillPending.length;
          const colLabel = `第 ${tc.index + 1} 列`;
          if (success === 0 && failed === 0 && pending === 0) {
            lines.push(`${colLabel}：无新生成结果`);
          } else {
            const parts = [];
            if (success > 0) parts.push(`${success} 张成功`);
            if (failed > 0) parts.push(`${failed} 张失败`);
            if (pending > 0) parts.push(`${pending} 张仍在生成中`);
            lines.push(`${colLabel}：${parts.join('，')}`);
          }
        }
        return lines.join('\n');
      }
      case 'switch_to_sandbox': {
        actions.setPage('sandbox');
        return '已切换到 API 调试沙盒页面';
      }
      case 'switch_to_home': {
        actions.setPage('home');
        return '已切换回主页面';
      }
      case 'get_page_status': {
        const cols = actions.getColumns();
        const summary = cols.map((c, i) => {
          const success = c.results.filter(r => r.imageUrl).length;
          const failed = c.results.filter(r => r.errorMessage).length;
          const generating = c.results.filter(r => !r.imageUrl && !r.errorMessage).length;
          const favorited = c.results.filter(r => r.favorited).length;
          const statusParts = [];
          if (success > 0) statusParts.push(`${success} 成功`);
          if (failed > 0) statusParts.push(`${failed} 失败`);
          if (generating > 0) statusParts.push(`${generating} 生成中`);
          if (statusParts.length === 0) statusParts.push('0');
          return `列${i + 1}(${c.name}): 模型=${c.model} 比例=${c.aspectRatio} 分辨率=${c.resolution} prompt="${c.prompt.substring(0, 30)}" 结果=${c.resultCount}(${statusParts.join('/')}) 收藏=${favorited}${c.isGenerating ? ' [生成中]' : ''}`;
        }).join('\n');
        return `当前页面: ${actions.getPage()}\n生图列:\n${summary || '（无）'}`;
      }
      case 'clear_results': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx === -1) {
          cols.forEach(c => actions.updateColumn(c.id, { results: [] }));
          return '已清除所有列的结果';
        } else if (idx >= 0 && idx < cols.length) {
          actions.updateColumn(cols[idx].id, { results: [] });
          return `已清除第 ${idx + 1} 列的结果`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'delete_image': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          const col = cols[colIdx];
          if (imgIdx >= 0 && imgIdx < col.results.length) {
            actions.deleteImage(col.id, imgIdx);
            return `已删除第 ${colIdx + 1} 列第 ${imgIdx + 1} 张图片`;
          }
          return `图片索引 ${imgIdx} 无效，该列共 ${col.results.length} 张图片`;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'toggle_favorite': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          const col = cols[colIdx];
          if (imgIdx >= 0 && imgIdx < col.results.length) {
            const wasFavorited = col.results[imgIdx].favorited;
            actions.toggleFavorite(col.id, imgIdx);
            return wasFavorited
              ? `已取消第 ${colIdx + 1} 列第 ${imgIdx + 1} 张图片的收藏`
              : `已收藏第 ${colIdx + 1} 列第 ${imgIdx + 1} 张图片`;
          }
          return `图片索引 ${imgIdx} 无效，该列共 ${col.results.length} 张图片`;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'abort_generate': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.abortGenerate(cols[idx].id);
          return `已中止第 ${idx + 1} 列的生成`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'add_ref_image': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          const result = await actions.addRefImage(cols[idx].id, args.url);
          return result;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'remove_ref_image': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.removeRefImage(cols[idx].id, args.refIndex);
          return `已删除第 ${idx + 1} 列第 ${args.refIndex + 1} 张参考图`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'load_preset_ref_images': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          const result = await actions.loadPresetRefImages(cols[idx].id);
          return result;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'use_result_as_ref': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          const result = await actions.useResultAsRef(cols[colIdx].id, imgIdx);
          return result;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'download_image': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          actions.downloadImage(cols[colIdx].id, imgIdx);
          return `已在第 ${colIdx + 1} 列下载第 ${imgIdx + 1} 张图片`;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'retry_generation': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          actions.retryImage(cols[colIdx].id, imgIdx);
          return `已重试第 ${colIdx + 1} 列第 ${imgIdx + 1} 张图片的生成`;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'clear_error_cards': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx === -1) {
          cols.forEach(c => actions.clearErrorCards(c.id));
          return '已清除所有列的报错卡片';
        } else if (idx >= 0 && idx < cols.length) {
          actions.clearErrorCards(cols[idx].id);
          return `已清除第 ${idx + 1} 列的报错卡片`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'clear_column_config': {
        const cols = actions.getColumns();
        const idx = args.columnIndex;
        if (idx >= 0 && idx < cols.length) {
          actions.clearColumnConfig(cols[idx].id);
          return `已清空第 ${idx + 1} 列的提示词和参考图`;
        }
        return `列索引 ${idx} 无效`;
      }
      case 'apply_card_config': {
        const cols = actions.getColumns();
        const colIdx = args.columnIndex;
        const imgIdx = args.imageIndex;
        if (colIdx >= 0 && colIdx < cols.length) {
          actions.applyCardConfig(cols[colIdx].id, imgIdx);
          return `已将第 ${colIdx + 1} 列第 ${imgIdx + 1} 张卡片的配置应用到该列`;
        }
        return `列索引 ${colIdx} 无效`;
      }
      case 'create_column_at_start': {
        actions.createColumnAtStart();
        const cols = actions.getColumns();
        return `已在首部创建第 1 个生图列`;
      }
      case 'create_column_at': {
        actions.createColumnAt(args.afterColumnIndex);
        const cols = actions.getColumns();
        return `已在第 ${args.afterColumnIndex + 1} 列后插入新列，当前共 ${cols.length} 列`;
      }
      case 'web_search': {
        const bochaKey = localStorage.getItem('bocha_api_key');
        if (!bochaKey) {
          return '请先在右上角"设置"中配置博查 API Key（bocha_api_key）';
        }
        const query = args.query;
        const count = args.count || 5;
        try {
          // 使用博查 AI Search API（支持返回网页+图片）
          const res = await fetch('/api/bocha/ai-search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-bocha-key': bochaKey,
            },
            body: JSON.stringify({ query, count, answer: false, stream: false }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return `博查搜索失败 (${res.status}): ${errText}`;
          }
          const data = await res.json();

          let parts: string[] = [];
          let imageUrls: string[] = [];

          // 解析 messages 中的各个消息
          const messages = data?.messages || [];
          for (const msg of messages) {
            if (msg.type === 'source' && msg.content_type === 'webpage') {
              // 网页结果
              const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
              const pages = content?.value || [];
              const textResults = pages.map((p: any, i: number) =>
                `[${i + 1}] ${p.name}\n   链接: ${p.url}\n   摘要: ${(p.snippet || '').slice(0, 300)}`
              ).join('\n\n');
              if (textResults) {
                parts.push(`▶ 网页搜索结果(共${pages.length}条):\n${textResults}`);
              }
            } else if (msg.type === 'source' && msg.content_type === 'image') {
              // 图片结果
              const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
              const images = content?.value || [];
              for (const img of images) {
                if (img.contentUrl) imageUrls.push(img.contentUrl);
              }
              if (images.length > 0) {
                parts.push(`▶ 图片搜索结果(共${images.length}张):`);
                images.forEach((img: any, i: number) => {
                  parts.push(`  [${i + 1}] ${img.name || '无标题'}\n        URL: ${img.contentUrl || img.url}\n        ${img.snippet ? `摘要: ${img.snippet.slice(0, 200)}` : ''}`);
                });
              }
            } else if (msg.type === 'source' && msg.content_type === 'modal') {
              // 模态卡
              const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
              parts.push(`▶ ${content?.title || '模态信息'}:\n   ${content?.description || JSON.stringify(content).slice(0, 300)}`);
            } else if (msg.type === 'answer') {
              // AI 总结答案
              parts.push(`▶ AI 总结:\n${msg.content?.slice(0, 500)}`);
            }
          }

          // 单独返回图片 URL 列表（方便 agent 使用）
          if (imageUrls.length > 0) {
            parts.push(`\n▶ 可用的图片直链(共${imageUrls.length}张):`);
            imageUrls.forEach((url, i) => {
              parts.push(`  [图${i + 1}] ${url}`);
            });
          }

          const result = parts.join('\n\n');
          if (!result) return `搜索"${query}"未找到相关结果`;

          // 将图片 URL 列表附加到结果末尾，agent 可用 add_ref_image 将它们添加为参考图
          return result;
        } catch (err: any) {
          return `博查搜索出错: ${err.message}`;
        }
      }
      case 'add_to_gallery': {
        const origin = getUserIntent();
        await actions.addToGallery(args.url, args.name || '', origin);
        return `已将图片添加到素材参考图面板：${args.name || args.url}`;
      }
      case 'clear_gallery': {
        actions.clearGallery();
        return '已清空素材参考图面板';
      }
      case 'get_gallery_info': {
        const gallery = actions.getGalleryImages();
        if (gallery.length === 0) return '暂存区为空，暂无图片';
        const list = gallery.map((item, i) => `  [${i}] ${item.name}`).join('\n');
        return `暂存区共 ${gallery.length} 张图片：\n${list}\n\n用户可告知你使用哪张图（按序号），然后你用 add_gallery_ref 工具将其添加到生图列。`;
      }
      case 'add_gallery_ref': {
        const result = await actions.addGalleryRef(args.galleryIndex, args.columnIndex);
        return result;
      }
      case 'analyze_gallery_image': {
        const gallery = actions.getGalleryImages();
        const idx = args.galleryIndex;
        if (idx < 0 || idx >= gallery.length) return `暂存区索引 ${idx} 无效`;
        const imgUrl = gallery[idx].url;
        // 优先使用缓存的分析结果
        const cached = getCachedVisualAnalysis(imgUrl);
        if (cached) {
          return `暂存区第 ${idx + 1} 张图"${gallery[idx].name}"的视觉特征（已缓存）:\n${JSON.stringify(cached, null, 2)}`;
        }
        // 未缓存时调用视觉分析子 Agent 分析图片
        const apiKeyValue = localStorage.getItem('agent_qwen_api_key') || '';
        if (apiKeyValue) {
          try {
            const analysis = await runVisualAnalyst(apiKeyValue, `分析暂存区第 ${idx + 1} 张图"${gallery[idx].name}"`, '', imgUrl, undefined, undefined);
            if (analysis) {
              setCachedVisualAnalysis(imgUrl, analysis);
              return `暂存区第 ${idx + 1} 张图"${gallery[idx].name}"的视觉特征:\n${JSON.stringify(analysis, null, 2)}`;
            }
          } catch (e) {
            // 分析失败，回退到原流程
          }
        }
        const result = `正在分析暂存区第 ${idx + 1} 张图"${gallery[idx].name}"的视觉特征`;
        const compressed = await compressImage(imgUrl, 2 * 1024 * 1024);
        if (compressed.startsWith('data:')) {
          const key = `gallery_${idx}_${Date.now()}`;
          await dbPut(key, compressed);
          toolImageRef.current = compressed;
        }
        return result;
      }
      case 'analyze_image_url': {
        // 优先使用缓存的分析结果
        const cached = getCachedVisualAnalysis(args.url);
        if (cached) {
          return `图片 URL 的视觉特征（已缓存）:\n${JSON.stringify(cached, null, 2)}`;
        }
        // 未缓存时调用视觉分析子 Agent 分析图片
        const apiKeyValue = localStorage.getItem('agent_qwen_api_key') || '';
        if (apiKeyValue) {
          try {
            const analysis = await runVisualAnalyst(apiKeyValue, '分析图片 URL 的内容', '', args.url, undefined, undefined);
            if (analysis) {
              setCachedVisualAnalysis(args.url, analysis);
              return `图片 URL 的视觉特征:\n${JSON.stringify(analysis, null, 2)}`;
            }
          } catch (e) {
            // 分析失败，回退到原流程
          }
        }
        const result = '正在分析图片 URL 的内容';
        const compressed = await compressImage(args.url, 2 * 1024 * 1024);
        if (compressed.startsWith('data:')) {
          const key = `url_${Date.now()}`;
          await dbPut(key, compressed);
          toolImageRef.current = compressed;
        }
        return result;
      }
      default:
        return `未知操作: ${name}`;
    }
  }, [actions]);

  const processRound = useCallback(async (
    msgs: AgentMessage[],
    apiKeyValue: string,
    onStream?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ messages: AgentMessage[]; hasToolCalls: boolean }> => {
    const result = await callAgent(apiKeyValue, msgs, undefined, signal, undefined, onStream);
    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    };
    const newMsgs = [...msgs, assistantMsg];

    if (result.toolCalls.length === 0) return { messages: newMsgs, hasToolCalls: false };

    let updatedMsgs = [...newMsgs];
    for (const tc of result.toolCalls) {
      if (signal?.aborted) break;
      const toolResult = await executeToolCall(tc, updatedMsgs);
      const msg: AgentMessage & { imageUrl?: string } = {
        role: 'tool' as const,
        content: toolResult,
        tool_call_id: tc.id,
      };
      if (toolImageRef.current) {
        msg.imageUrl = toolImageRef.current;
        toolImageRef.current = undefined;
      }
      updatedMsgs.push(msg);
    }
    return { messages: updatedMsgs, hasToolCalls: true };
  }, [executeToolCall]);

  const processUntilDone = useCallback(async (
    msgs: AgentMessage[],
    apiKeyValue: string,
    signal?: AbortSignal,
  ): Promise<AgentMessage[]> => {
    let currentMsgs = [...msgs];
    let rounds = 0;
    while (rounds < 50 && !signal?.aborted) {
      rounds++;
      const { messages, hasToolCalls } = await processRound(currentMsgs, apiKeyValue, undefined, signal);
      currentMsgs = messages;
      if (!hasToolCalls) break;
    }
    return currentMsgs;
  }, [processRound]);

  const handleStop = useCallback(() => {
    stopControllerRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    
    const currentKey = localStorage.getItem('agent_qwen_api_key') || '';
    setApiKey(currentKey);
    
    if (!currentKey) {
      handleClose();
      alert('请先在右上角"设置"中配置通义千问 API Key');
      return;
    }

    setInputValue('');

    // 构建聚焦上下文（支持多选）
    let contextMsg = '';
    const focusColRefImages: string[] = [];
    const focusImageUrls: string[] = [];

    const urlToDataUrl = async (url: string): Promise<string | undefined> => {
      if (url.startsWith('data:')) return url;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return undefined;
      }
    };

    if (focusContexts.length > 0) {
      const cols = actions.getColumns();
      const lines: string[] = [];

      for (let i = 0; i < focusContexts.length; i++) {
        const ctx = focusContexts[i];
        const idx = cols.findIndex(c => c.id === ctx.colId);
        const col = idx >= 0 ? cols[idx] : null;

        if (ctx.type === 'gallery-image') {
          const gallery = actions.getGalleryImages();
          const itemIdx = ctx.itemId ? parseInt(ctx.itemId, 10) : -1;
          const item = itemIdx >= 0 && itemIdx < gallery.length ? gallery[itemIdx] : null;
          const originInfo = item?.origin ? ` | 来历: "${item.origin}"` : '';
          lines.push(`  [${i + 1}] 暂存区图片${originInfo}`);
          if (ctx.imageUrl) {
            const dataUrl = await urlToDataUrl(ctx.imageUrl);
            if (dataUrl) focusImageUrls.push(dataUrl);
          }
        } else if (col) {
          const typeLabel: Record<string, string> = {
            'column': `生图列 "${col.name}"`,
            'prompt': `生图列 "${col.name}" 的提示词编辑框`,
            'config': `生图列 "${col.name}" 的参数选择区`,
            'ref-image': `生图列 "${col.name}" 的参考图`,
            'result-image': `生图列 "${col.name}" 的生成结果图片`,
          };
          const label = typeLabel[ctx.type] || `${ctx.type}`;
          lines.push(`  [${i + 1}] ${label} | 列索引: ${idx} | 模型: ${col.model} | 比例: ${col.aspectRatio} | 分辨率: ${col.resolution} | 提示词: "${col.prompt}" | 参考图: ${col.refImages.length} | 结果数: ${col.resultCount}`);

          if (ctx.imageUrl) {
            const dataUrl = await urlToDataUrl(ctx.imageUrl);
            if (dataUrl) focusImageUrls.push(dataUrl);
          }

          if ((ctx.type === 'prompt' || ctx.type === 'config') && col.refImages.length > 0) {
            for (const url of col.refImages) {
              const dataUrl = await urlToDataUrl(url);
              if (dataUrl) focusColRefImages.push(dataUrl);
            }
          }
        }
      }

      contextMsg = focusContexts.length === 1 
        ? `[当前聚焦: ${lines[0].replace('  [1] ', '')}]`
        : `[当前聚焦 ${focusContexts.length} 个元素]:\n${lines.join('\n')}`;
    }

    const displayUserMsg: AgentMessage = {
      role: 'user',
      content: text,
      context: contextMsg || undefined,
      imageUrl: focusImageUrls.length > 0 ? focusImageUrls[0] : undefined,
      ...(focusImageUrls.length > 1 || focusColRefImages.length > 0 ? { 
        imageUrls: [...focusImageUrls.slice(1), ...focusColRefImages] 
      } : {}),
    };
    const newMsgs = [...messages, displayUserMsg];
    setMessages(newMsgs);
    setIsLoading(true);
    // 发送后立即聚焦输入框
    requestAnimationFrame(() => inputRef.current?.focus());

    // 创建停止控制器
    const controller = new AbortController();
    stopControllerRef.current = controller;

    try {
      const prepared = await prepareSubAgentContext(
        currentKey,
        text,
        contextMsg,
        displayUserMsg.imageUrl,
        displayUserMsg.imageUrls,
        controller.signal,
        (status) => setMessages(prev => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1].role === 'assistant' && next[next.length - 1].content === '') {
            next[next.length - 1] = { ...next[next.length - 1], content: status };
          } else {
            next.push({ role: 'assistant', content: status });
          }
          return next;
        }),
      );
      const enrichedUserMsg: AgentMessage = {
        ...displayUserMsg,
        context: [
          contextMsg,
          `[页面状态快照]\n${prepared.pageSnapshot}`,
          prepared.notes,
        ].filter(Boolean).join('\n\n'),
      };

      // 保存任务目标，每轮循环注入提醒
      goalRef.current = prepared.plan?.goal || '';

      let currentMsgs = [...messages, enrichedUserMsg];
      let rounds = 0;
      let hasMoreTools = true;
      let stopped = false;
      let contentRetries = 0;
      while (rounds < 50 && hasMoreTools && !controller.signal.aborted) {
        rounds++;
        // 每轮注入目标提醒，防止 Agent 在长循环中丢失方向
        if (rounds > 1 && goalRef.current) {
          currentMsgs = [...currentMsgs, {
            role: 'user' as const,
            content: '',
            context: `[任务目标] ${goalRef.current}。请记住这是你的最终目标，所有操作都应围绕此目标进行。已完成的部分不需要重复执行。`,
          }];
        }
        // 添加流式占位消息，实时显示生成内容
        setMessages([...currentMsgs, { role: 'assistant', content: '' }]);
        try {
          const { messages: roundMsgs, hasToolCalls } = await processRound(
            currentMsgs, currentKey,
            (delta) => {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + delta };
                }
                return next;
              });
            },
            controller.signal,
          );
          currentMsgs = roundMsgs;
          // 剥离 tool 消息中的 imageUrl，避免 data URL 在对话中累积撑爆 6MB 限制
          currentMsgs = currentMsgs.map(m => m.role === 'tool' ? { ...m, imageUrl: undefined } : m);
          setMessages([...currentMsgs]);
          hasMoreTools = hasToolCalls;
          if (controller.signal.aborted) { stopped = true; break; }
          contentRetries = 0; // 成功后重置重试计数
        } catch (roundErr: any) {
          // 内容安全审核拒绝时，删除触发审核的消息再重试
          if (roundErr.message?.includes('DataInspectionFailed') || roundErr.message?.includes('inappropriate content')) {
            contentRetries++;
            if (contentRetries > 3) throw new Error('内容安全审核多次拒绝，请检查输入内容后重试');
            // 删除最后一条 assistant 消息（触发审核的那条）
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg?.role === 'assistant') currentMsgs = currentMsgs.slice(0, -1);
            // 插入重试指令
            currentMsgs = [...currentMsgs, {
              role: 'user' as const,
              content: '之前的内容被安全审核拦截，请换一种更安全的表述重试。',
            }];
            setMessages([...currentMsgs]);
            continue;
          }
          throw roundErr; // 其他错误继续向外抛
        }
      }

      // 如果被停止，记录停止上下文
      if (controller.signal.aborted) stopped = true;
      if (stopped) {
        const stopMsg: AgentMessage = {
          role: 'assistant',
          content: '\n\n⏹ [用户停止了操作，后续对话可以此节点为上下文继续]',
        };
        currentMsgs = [...currentMsgs, stopMsg];
        setMessages(currentMsgs);
        addLogRound({ userInput: text + ' [用户停止]', messages: currentMsgs });
        return;
      }

      const toolResults = currentMsgs
        .filter(msg => msg.role === 'tool')
        .slice(-10)
        .map((msg, idx) => `工具结果${idx + 1}: ${msg.content}`)
        .join('\n');
      if (toolResults) {
        try {
          const review = await runResultReviewer(currentKey, text, buildPageSnapshot(contextMsg), toolResults);
          if (!review.isComplete && review.nextActions.length > 0) {
            currentMsgs = [
              ...currentMsgs,
              {
                role: 'user' as const,
                content: '',
                context: buildInternalAgentNotes(undefined, undefined, undefined, review),
              },
            ];

            let reviewRounds = 0;
            let reviewNeedsTools = true;
            while (reviewRounds < 5 && reviewNeedsTools && !controller.signal.aborted) {
              reviewRounds++;
              setMessages([...currentMsgs, { role: 'assistant', content: '' }]);
              const { messages: reviewMsgs, hasToolCalls } = await processRound(
                currentMsgs, currentKey,
                (delta) => {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last && last.role === 'assistant') {
                      next[next.length - 1] = { ...last, content: last.content + delta };
                    }
                    return next;
                  });
                },
                controller.signal,
              );
              currentMsgs = reviewMsgs;
              setMessages([...currentMsgs]);
              reviewNeedsTools = hasToolCalls;
            }
          }
        } catch {
          // 复核失败不阻断主流程，主 Agent 已经完成了主要操作。
        }
      }

      setMessages(currentMsgs);
      addLogRound({ userInput: text, messages: currentMsgs });
    } catch (err: any) {
      // 用户主动停止的 AbortError 不显示错误
      if (err.name === 'AbortError') {
        const stopMsgs = [...newMsgs, { role: 'assistant' as const, content: '\n\n⏹ [操作已停止]' }];
        setMessages(stopMsgs);
        addLogRound({ userInput: text + ' [用户停止]', messages: stopMsgs });
        return;
      }
      const errorMsgs = [...newMsgs, { role: 'assistant' as const, content: `❌ 出错: ${err.message}` }];
      setMessages(prev => [...prev, errorMsgs[errorMsgs.length - 1]]);
      addLogRound({ userInput: text, messages: errorMsgs });
    } finally {
      setIsLoading(false);
      stopControllerRef.current = null;
    }
  }, [inputValue, isLoading, messages, focusContexts, actions, prepareSubAgentContext, buildInternalAgentNotes, buildPageSnapshot, processRound]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoading) handleStop();
      else handleSubmit();
    } else if (e.key === 'Escape') {
      if (isLoading) handleStop();
      else handleClose();
    }
  }, [handleSubmit, handleClose, handleStop, isLoading]);

  return (
    <>
      <style>{`
        .focus-ring-flow {
          outline: 2px solid #4f39f6;
          outline-offset: 1px;
          animation: flowBorder 2s linear infinite;
        }
        @keyframes flowBorder {
          0%   { outline-color: #4f39f6; }
          25%  { outline-color: #6d5cf5; }
          50%  { outline-color: #818cf8; }
          75%  { outline-color: #c084fc; }
          100% { outline-color: #4f39f6; }
        }
      `}</style>
      {/* 鼠标跟随标签 */}
      <div
        ref={tooltipRef}
        className="fixed pointer-events-none z-[10000] transition-opacity duration-200"
        style={{ left: position.x, top: position.y, opacity: isOpen ? 0 : 1 }}
      >
        <div className="bg-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-2xl shadow-lg border border-[#4f39f6]/40 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="font-semibold">Agent</span>
          <span className="text-white/50">右键呼出</span>
        </div>
      </div>

      {/* 面板：只有输入框 / 有回复时展开 */}
      {isOpen && (
        <div
          ref={containerRef}
          className="fixed z-[10001]"
          style={{ left: openPosition.x, bottom: window.innerHeight - openPosition.y }}
        >
          {/* 回复面板 — 有消息时才展开，可拖拽 */}
          {hasReplies && (
            <div
              onMouseDown={handleDragStart}
              className="bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-700/50 shadow-2xl w-[270px] max-h-[300px] overflow-y-auto p-3 space-y-2 mb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden cursor-grab active:cursor-grabbing">
              {messages.map((msg, idx) => {
                if (!msg.content && msg.role !== 'tool') return null;
                if (msg.role === 'assistant' && !msg.content && msg.tool_calls) return null;
                if (msg.role === 'assistant' && !msg.content && !msg.tool_calls) return null;
                return (
                  <div key={idx} className="flex justify-start">
                    {msg.role === 'tool' ? (
                      (() => {
                        const isExpanded = expandedTools.has(idx);
                        const preview = msg.content.length > 40 ? msg.content.substring(0, 40) + '…' : msg.content;
                        return (
                          <div
                            className="w-full bg-zinc-800/30 text-zinc-500 rounded-lg px-2.5 py-1 text-[10px] leading-relaxed cursor-pointer hover:bg-zinc-800/50 transition-colors select-none"
                            onClick={(e) => handleToolClick(idx, e)}
                          >
                            <span className="text-zinc-600">{isExpanded ? '▼ ' : '▶ '}</span>
                            {isExpanded ? (
                              <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                            ) : (
                              <span>{preview}</span>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div
                        className={`w-fit max-w-full px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words select-none ${
                          msg.role === 'user' ? 'rounded-xl' : 'rounded-full'
                        } ${
                          msg.role === 'user'
                            ? 'bg-[#4f39f6]/80 text-white'
                            : 'bg-zinc-800/70 text-zinc-100'
                        }`}
                      >
                        {msg.content}
                        {msg.imageUrl && (
                          <img src={msg.imageUrl} alt="attached" className="mt-1.5 max-w-full rounded-lg" style={{ maxHeight: '120px' }} />
                        )}
                        {msg.imageUrls && msg.imageUrls.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {msg.imageUrls.map((url, i) => (
                              <img key={i} src={url} alt={`ref-${i}`} className="rounded-lg object-cover" style={{ width: '60px', height: '60px' }} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800/50 rounded-xl px-3 py-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* 输入框 */}
          <div className="relative w-[270px]">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="需要我帮你做什么"
              className="w-full bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 rounded-full pl-4 pr-10 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 shadow-2xl shadow-black/20 ring-1 ring-inset ring-white/[0.06] transition-all"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={isLoading ? handleStop : handleSubmit}
              disabled={!isLoading && (!inputValue.trim() || isLoading)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                isLoading
                  ? 'bg-zinc-600 hover:bg-zinc-500 text-white'
                  : 'bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white'
              }`}
            >
              {isLoading ? <Square className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
