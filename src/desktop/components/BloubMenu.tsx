import { useId, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { bloubExpressions, bloubShapes, bloubStates, type BloubSelection } from './bloubCatalog';
import MotionChoice from './MotionChoice';
import MotionPanel from './MotionPanel';

interface BloubMenuProps {
  selection: BloubSelection | null;
  style: CSSProperties;
  onSelect: (selection: BloubSelection | null) => void;
  onClose: () => void;
}

export default function BloubMenu({ selection, style, onSelect, onClose }: BloubMenuProps) {
  const [tab, setTab] = useState<BloubSelection['kind']>('state');
  const indicatorId = useId();
  const choices: { label: string; selection: BloubSelection }[] = tab === 'state'
    ? bloubStates.map(({ id, label }) => ({ label, selection: { kind: 'state', id } }))
    : tab === 'expression'
      ? bloubExpressions.map(({ id, label }) => ({ label, selection: { kind: 'expression', id } }))
      : bloubShapes.map(({ id, label }) => ({ label, selection: { kind: 'shape', id } }));

  return (
    <motion.section className="companion-menu" style={style} role="dialog" aria-label="Bloub 动作与表情"
      initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.18 }}>
      <div className="companion-menu-heading">
        <div><strong>和 Bloub 玩一会儿</strong><p>换个动作，换种心情。</p></div>
        <button type="button" className="icon-button" aria-label="关闭动作面板" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="companion-menu-tabs" role="group" aria-label="伙伴外观分类">
        {([
          ['state', `动作 ${bloubStates.length}`], ['expression', `表情 ${bloubExpressions.length}`],
          ['shape', `外形 ${bloubShapes.length}`],
        ] as const).map(([id, label]) => (
          <MotionChoice key={id} selected={tab === id} indicatorId={indicatorId}
            className="source-chip" onClick={() => setTab(id)}>{label}</MotionChoice>
        ))}
      </div>
      <MotionPanel className="companion-menu-grid" transitionKey={tab}>
        {choices.map((choice) => (
          <MotionChoice key={choice.selection.id} className="companion-pose-button"
            selected={selection?.kind === choice.selection.kind && selection.id === choice.selection.id}
            indicatorId={`${indicatorId}-pose`} onClick={() => onSelect(choice.selection)}>{choice.label}</MotionChoice>
        ))}
      </MotionPanel>
      <button type="button" className="soft-button companion-auto-button" onClick={() => onSelect(null)}
        disabled={selection === null}>{selection ? '回到跟随音乐' : '正在跟随音乐'}</button>
    </motion.section>
  );
}
