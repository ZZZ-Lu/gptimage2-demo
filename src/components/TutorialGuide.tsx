import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles, Zap, Wand2, Bot, Layers, Film } from 'lucide-react';

export interface TutorialStep {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  target?: string;
  placement?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  actionText?: string;
  highlight?: boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: '赛博西游短剧',
    subtitle: '第一关 · 初识界面',
    description: '欢迎来到赛博朋克世界！你将作为导演，用 AI 制作一部西游风格的赛博朋克短剧。\n\n本教程将带你体验所有核心功能，包括生成图片、使用 AI Agent、管理参考图等。',
    icon: <Sparkles className="w-8 h-8 text-[#4f39f6]" />,
    placement: 'center',
    actionText: '开始冒险',
  },
  {
    id: 'project',
    title: '项目与列',
    subtitle: '第一关 · 初识界面',
    description: '左上角是你的项目，当前项目叫"赛博西游短剧"。\n\n每个项目由多个"列"组成，每一列就像一个独立的画师——你可以设置不同的提示词、模型和参数，同时生成多种风格的图片。',
    icon: <Layers className="w-8 h-8 text-[#4f39f6]" />,
    target: '.project-selector',
    placement: 'bottom',
    actionText: '下一步',
  },
  {
    id: 'generate',
    title: '生成第一张图',
    subtitle: '第二关 · 召唤悟空',
    description: '中间是提示词输入区，写好后点击生成按钮即可开始绘图。\n\n现在让我们召唤第一位主角——赛博孙悟空！点击"生成"按钮试试吧。',
    icon: <Zap className="w-8 h-8 text-[#4f39f6]" />,
    target: '[data-generate-btn]',
    placement: 'bottom',
    actionText: '我知道了',
    highlight: true,
  },
  {
    id: 'refimage',
    title: '参考图的魔力',
    subtitle: '第三关 · 赛博唐僧',
    description: '每列都有参考图区域，上传图片可以让 AI 模仿其风格或构图。\n\n试试把左边暂存区的图片拖到参考图区域，看看会发生什么奇妙的变化！',
    icon: <Wand2 className="w-8 h-8 text-[#4f39f6]" />,
    target: '.ref-image-area',
    placement: 'right',
    actionText: '下一步',
    highlight: true,
  },
  {
    id: 'agent',
    title: 'AI Agent 助手',
    subtitle: '第四关 · Agent初体验',
    description: '右下角悬浮的是 AI Agent，它能听懂你的自然语言指令！\n\n试试点击它，说"帮我新建一列，生成赛博朋克风格的猪八戒"，看看会发生什么。',
    icon: <Bot className="w-8 h-8 text-[#4f39f6]" />,
    target: '[data-agent-fab]',
    placement: 'left',
    actionText: '去试试',
    highlight: true,
  },
  {
    id: 'gallery',
    title: '暂存区',
    subtitle: '第五关 · 暂存区妙用',
    description: '最左边的竖条是暂存区，你可以把喜欢的图片收藏到这里。\n\n悬停查看详情，拖到参考图区域使用，还能让 Agent 分析图片内容！',
    icon: <Layers className="w-8 h-8 text-[#4f39f6]" />,
    target: '.gallery-panel',
    placement: 'right',
    actionText: '下一步',
    highlight: true,
  },
  {
    id: 'finale',
    title: '短剧成片',
    subtitle: '第六关 · 最终挑战',
    description: '恭喜你掌握了所有技能！现在是时候大展身手了。\n\n打开 Agent，告诉它："帮我制作一部赛博西游短剧，包含悟空、唐僧、八戒三个角色，每个角色生成一张海报图"。\n\n剩下的，交给 AI 吧！',
    icon: <Film className="w-8 h-8 text-[#4f39f6]" />,
    placement: 'center',
    actionText: '开始创作',
  },
];

interface TutorialGuideProps {
  isOpen: boolean;
  onClose: () => void;
  currentStep: number;
  onNext: () => void;
  onPrev: () => void;
  onJump: (step: number) => void;
  totalSteps: number;
  step: TutorialStep;
}

export default function TutorialGuide({
  isOpen,
  onClose,
  currentStep,
  onNext,
  onPrev,
  onJump,
  totalSteps,
  step,
}: TutorialGuideProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!step.target || step.placement === 'center') {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [step.target, step.placement]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const timer = setTimeout(updatePosition, 100);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      clearTimeout(timer);
    };
  }, [isOpen, step.id, updatePosition]);

  useEffect(() => {
    if (!cardRef.current || !targetRect || step.placement === 'center') return;

    const card = cardRef.current.getBoundingClientRect();
    let top = 0, left = 0;

    switch (step.placement) {
      case 'bottom':
        top = targetRect.bottom + 12;
        left = targetRect.left + targetRect.width / 2 - card.width / 2;
        break;
      case 'top':
        top = targetRect.top - card.height - 12;
        left = targetRect.left + targetRect.width / 2 - card.width / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - card.height / 2;
        left = targetRect.left - card.width - 12;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - card.height / 2;
        left = targetRect.right + 12;
        break;
    }

    left = Math.max(16, Math.min(left, window.innerWidth - card.width - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - card.height - 16));

    setPosition({ top, left });
  }, [targetRect, step.placement, isOpen]);

  if (!isOpen) return null;

  const isCenter = step.placement === 'center' || !targetRect;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {step.highlight && targetRect && (
        <div
          className="absolute rounded-xl ring-2 ring-[#4f39f6] ring-offset-2 ring-offset-transparent animate-pulse"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        ref={cardRef}
        className="absolute pointer-events-auto"
        style={
          isCenter
            ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 420 }
            : { top: position.top, left: position.left, width: 340 }
        }
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-zinc-100 overflow-hidden">
          <div className="relative bg-gradient-to-br from-[#4f39f6] to-[#7c3aed] px-5 py-4 text-white">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                {step.icon}
              </div>
              <div>
                <div className="text-[11px] font-medium opacity-80 tracking-wide">{step.subtitle}</div>
                <div className="text-lg font-bold">{step.title}</div>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-[13px] text-zinc-600 leading-relaxed whitespace-pre-line">
              {step.description}
            </p>
          </div>

          <div className="px-5 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => onJump(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentStep
                      ? 'bg-[#4f39f6] w-5'
                      : i < currentStep
                      ? 'bg-[#4f39f6]/40'
                      : 'bg-zinc-200'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={onPrev}
                  className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  上一步
                </button>
              )}
              <button
                onClick={onNext}
                className="flex items-center gap-1 px-4 py-1.5 bg-[#4f39f6] hover:bg-[#4338ca] text-white text-[12px] font-medium rounded-lg transition-colors"
              >
                {step.actionText || '下一步'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
