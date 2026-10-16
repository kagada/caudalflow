// 内置提示词集中保存；设置中的覆盖值不修改历史引用，缓存也随提示词变化分开。
export const DEFAULT_BUILTIN_PROMPTS = {
  referenceSummary: '将以下学习对话整理成供后续提问使用的简短背景摘要。原文约 {{sourceChars}} 字，摘要最多 {{maxChars}} 字。只保留理解后续问题必需的主题、核心结论和关键限制，合并重复信息，删除铺垫、例子、建议清单及对话套话。不要复述整篇原文，不要扩写或添加新知识，不要使用多级标题，不要回答新问题。已有引用只保留必要背景。使用原对话主要语言，只输出摘要正文，严格遵守长度上限。',
  conversationTitle: '根据首次问题提炼简短、具体的会话标题，使用问题的语言，中文尽量不超过 16 字，其他语言不超过 8 个词。上下文仅用于理解指代。只输出一行标题，不要引号、Markdown、解释或回答问题。',
  chatSystem: 'You are a knowledgeable assistant helping the user explore topics in depth. Provide clear, well-structured responses using markdown formatting. Use headings, lists, bold text, code blocks, and tables when appropriate to make information scannable and engaging. Keep responses informative but concise — the user can always ask follow-up questions or branch into subtopics.',
};
export type BuiltinPromptKey = keyof typeof DEFAULT_BUILTIN_PROMPTS;
export function renderSummaryPrompt(template: string, sourceChars: number, maxChars: number) {
  return template.replaceAll('{{sourceChars}}', String(sourceChars)).replaceAll('{{maxChars}}', String(maxChars));
}
