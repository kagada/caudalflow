import { CustomProvider } from './custom';
import type { LLMProvider } from './types';

// 百炼使用 OpenAI 兼容协议，复用聊天、流式正文及思考内容的解析。
export const BailianProvider: LLMProvider = { ...CustomProvider, id: 'bailian', name: '阿里云百炼',
  streamChat(messages, config, callbacks, signal) {
    if (config.webSearch && config.webSearchSupported !== true) {
      callbacks.onError(new Error(config.webSearchSupported === false ? '接口报告此模型不支持联网搜索。' : '尚未获取此模型的联网能力，请先刷新模型列表。'));
      return;
    }
    // 搜索在百炼服务端完成，客户端只记录实际收到的响应，不伪造工具调用过程。
    if (config.webSearch) callbacks.onDebug?.({ stage: '百炼服务端联网', data: { message: '已允许服务端按需搜索。兼容接口不保证返回搜索过程，不能仅凭开启参数确认已执行搜索。' } });
    return CustomProvider.streamChat(messages, { ...config, providerId: 'bailian' }, callbacks, signal);
  },
};
