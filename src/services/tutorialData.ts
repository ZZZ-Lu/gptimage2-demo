export interface TutorialColumnPreset {
  name: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  prompt: string;
  refImages: string[];
}

export interface TutorialProjectPreset {
  name: string;
  columns: TutorialColumnPreset[];
  gallery: { name: string; prompt: string; origin: string }[];
}

export const TUTORIAL_PROJECT: TutorialProjectPreset = {
  name: '赛博西游短剧',
  columns: [
    {
      name: '孙悟空 · 霓虹战士',
      model: 'flux-schnell',
      aspectRatio: '3:4',
      resolution: '1024x1024',
      quality: 'high',
      prompt: '赛博朋克风格，孙悟空，金色机械装甲，霓虹光效，紫色光晕，未来城市背景，雨夜，高科技金箍棒，赛博义眼，全身像，超高清细节',
      refImages: [],
    },
    {
      name: '唐僧 · 赛博法师',
      model: 'flux-schnell',
      aspectRatio: '3:4',
      resolution: '1024x1024',
      quality: 'high',
      prompt: '赛博朋克风格，唐僧，白色禅意长袍，全息投影经文，未来感光头，霓虹佛珠，赛博法杖，平静面容，都市夜景，超现实科幻',
      refImages: [],
    },
  ],
  gallery: [
    {
      name: '赛博城夜景',
      prompt: '赛博朋克城市夜景，霓虹灯，雨后街道，全息广告，未来都市',
      origin: '教学项目 - 赛博西游短剧参考素材',
    },
    {
      name: '机械武士风',
      prompt: '日式赛博武士，机械面具，武士刀，霓虹灯，钢铁盔甲',
      origin: '教学项目 - 赛博西游短剧参考素材',
    },
  ],
};

export const TUTORIAL_AGENT_PROMPTS = {
  step4: '帮我新建一列，生成赛博朋克风格的猪八戒，要胖胖的很可爱，带着高科技九齿钉耙',
  step6: '帮我制作一部赛博西游短剧，包含孙悟空、唐僧、猪八戒三个角色，每个角色各生成一张海报图，风格统一为赛博朋克霓虹风',
};
