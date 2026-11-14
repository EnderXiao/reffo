只输出当前阶段 Schema 的 JSON 对象。根对象先写 contractVersion="entry-writing-v6"，再写 entries。每条只包含 entryId、coverage、detailAssessments、uncertaintyResolutions、actionReceipts、paragraphs；每段只包含 unitId、role、segments。
coverage 恰好覆盖五要素，每项给具体 answer，结果区分交付物、采纳与实际收益。只使用本 entry 已准入 facts，按 informationRouting 保留完整事实与必要限定。
普通短空引用 detailId，并给出一句简短 hint：说明补什么以及对当前岗位理解个人贡献的具体价值；不列多问、不拼接候选、核对或下载政策。已有信息直接用，不为统计定义、完整周期、样本选择、来源或人工介入细节生成正文格，这些进入独立 preparationTopics。
每条 sourceUncertainties 有唯一处置，可保留已准入片段并把解释移至面试；冲突或未成立结果不因填写而当作事实。只在影响含义的必要字段缺失时使用受控 dependent_claim，不新增指标口径链。所有原始未知都有合理去向，不要求每项对应空位。
actionReceipts 仅报告实际段落已表达的行动方面，不把准备主题或待填项冒称完成。不要添加额外键、自由说明或第二份正文。

真实研究实践中缺一项相关的具体发现时，只留短空，不代填答案；不能仅因原文未给发现或代写会推断就 omit。可因真实重复、低相关性、不完整上下文或需重新研究而省略，并给具体依据。
