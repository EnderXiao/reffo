import {describe, expect, test} from '@jest/globals';
import {getClientErrorMessage} from '../client-error';

describe('client error messages', () => {
  test('explains incomplete generated entries without replacing it with a generic error', () => {
    expect(getClientErrorMessage('GENERATED_ENTRIES_INCOMPLETE', 422, '简历生成失败'))
      .toBe('生成内容不完整，部分经历未正确生成，请重新生成');
  });
  test('explains when V5 blocks an incomplete resume from delivery', () => {
    expect(getClientErrorMessage(
      'V5_PRODUCT_QUALITY_BLOCKED',
      422,
      '处理失败',
    )).toBe('本次结果未达到可投递质量标准，系统已停止交付不完整简历');
  });
});
