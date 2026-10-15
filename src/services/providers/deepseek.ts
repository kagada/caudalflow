import { CustomProvider } from './custom';

// DeepSeek 沿用兼容接口的流式和思考处理，只提供独立的设置入口。
export const DeepSeekProvider = { ...CustomProvider, id: 'deepseek', name: 'DeepSeek' };
