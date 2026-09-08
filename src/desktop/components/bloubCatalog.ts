import { EXPRESSIONS, type ExpressionId } from '../../../vendor/bloub/src/bot/expressions';
import { SHAPES, type ShapeId } from '../../../vendor/bloub/src/bot/skins';
import { STATES, type StateId } from '../../../vendor/bloub/src/bot/states';

const stateLabels: Record<StateId, string> = {
  idle: '呼吸', thinking: '思考', wink: '眨眼', wide: '睁大眼睛', alert: '提醒',
  notify: '新消息', exclaim: '惊叹', sleep: '小憩', egg: '弹成蛋形', hexagon: '六边形',
  play: '播放', orbit: '环绕', swirl: '涡旋', burst: '绽放', comet: '彗星',
};
const expressionLabels: Record<ExpressionId, string> = {
  neutre: '平静', attentif: '专注', surpris: '惊讶', excite: '兴奋', heureux: '开心',
  hilare: '大笑', colere: '生气', triste: '难过', effraye: '害怕', mefiant: '怀疑',
  confus: '困惑', curieux: '好奇', fier: '得意', timide: '害羞', blase: '无聊', somnolent: '困倦',
};
const shapeLabels: Record<ShapeId, string> = {
  cercle: '圆球', galet: '卵石', squircle: '圆角方形', capsule: '胶囊',
  triangle: '三角形', hexagone: '六边形', nuage: '云朵', goutte: '水滴',
};

// 直接枚举上游完整目录；新增项会要求补齐中文名称，不维护缩水的演示清单。
export const bloubStates = STATES.map(({ id }) => ({ id, label: stateLabels[id] }));
export const bloubExpressions = EXPRESSIONS.map(({ id }) => ({ id, label: expressionLabels[id] }));
export const bloubShapes = SHAPES.map(({ id }) => ({ id, label: shapeLabels[id] }));
export type BloubSelection = { kind: 'state'; id: StateId }
  | { kind: 'expression'; id: ExpressionId } | { kind: 'shape'; id: ShapeId };
export const getBloubSelectionLabel = (selection: BloubSelection) => selection.kind === 'state'
  ? stateLabels[selection.id] : selection.kind === 'expression' ? expressionLabels[selection.id] : shapeLabels[selection.id];
