import rulesText from '../../rules/rules.yaml?raw';
import { parseRules } from './loadRules';
import type { RuleSet } from '../types/report';

let cached: RuleSet | null = null;

/** 載入打包進 App 的 rules/rules.yaml（修改 yaml 後重新建置即生效）。 */
export function getRules(): RuleSet {
  if (!cached) cached = parseRules(rulesText);
  return cached;
}
