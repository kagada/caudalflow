import { CustomProvider } from './custom';

// 百炼使用 OpenAI 兼容协议，复用聊天、流式正文及思考内容的解析。
export const BailianProvider = { ...CustomProvider, id: 'bailian', name: '阿里云百炼' };
