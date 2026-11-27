严格遵守当前 JSON Schema，只输出一个 JSON 对象，不输出 Markdown、解释、思维链或第二份正文。

根对象包含 contractVersion="entry-writing-v6" 和 entries。每个清单 entryId 恰好出现一次。entry 按 Schema 输出 coverage、detailAssessments、uncertaintyResolutions、paragraphs、actionReceipts；paragraph 只使用 Schema 字段。空数组或 null 仅用于允许的字段，必填文本应写清语义或未知原因。
