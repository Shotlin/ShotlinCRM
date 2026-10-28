'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { BLOCK_HELP, BLOCK_LABELS, type Block, type BlockType } from '@/server/services/deals/content';

const ORDER: BlockType[] = ['h1', 'h2', 'p', 'bullets', 'numbered', 'table', 'pagebreak'];
const newId = () => Math.random().toString(36).slice(2, 10);

// Writes the body of a proposal or agreement as blocks. The PDF is made from these.
export function BlockEditor({ blocks, onChange, disabled }: { blocks: Block[]; onChange: (next: Block[]) => void; disabled?: boolean }) {
  const update = (id: string, patch: Partial<Block>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = (type: BlockType) => onChange([...blocks, { id: newId(), type, text: '' }]);

  return (
    <div className="bk-blocks">
      {blocks.length === 0 ? <p className="bk-empty">Nothing written yet. Use a template above, or add your first block below.</p> : null}
      {blocks.map((block, index) => (
        <div key={block.id} className={`bk-block-row bk-block-${block.type}`}>
          <div className="bk-block-head">
            <select value={block.type} disabled={disabled} onChange={(event) => update(block.id, { type: event.target.value as BlockType })} aria-label="Block type">
              {ORDER.map((type) => <option key={type} value={type}>{BLOCK_LABELS[type]}</option>)}
            </select>
            <span className="bk-grow" />
            <button type="button" className="bk-iconbtn" aria-label="Move up" disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
            <button type="button" className="bk-iconbtn" aria-label="Move down" disabled={disabled || index === blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
            <button type="button" className="bk-iconbtn" aria-label="Delete block" disabled={disabled} onClick={() => onChange(blocks.filter((b) => b.id !== block.id))}><Trash2 size={15} /></button>
          </div>
          {block.type === 'pagebreak' ? (
            <p className="bk-sub">The next block starts on a new page.</p>
          ) : (
            <textarea
              rows={block.type === 'h1' || block.type === 'h2' ? 1 : block.type === 'p' ? 4 : 5}
              value={block.text}
              disabled={disabled}
              placeholder={BLOCK_HELP[block.type]}
              onChange={(event) => update(block.id, { text: event.target.value })}
              className={block.type === 'h1' || block.type === 'h2' ? 'bk-block-title' : undefined}
            />
          )}
        </div>
      ))}
      {!disabled ? (
        <div className="bk-block-add">
          <span className="bk-sub"><Plus size={13} aria-hidden="true" /> Add</span>
          {ORDER.map((type) => (
            <button key={type} type="button" className="btn btn-secondary btn-sm" onClick={() => add(type)}>{BLOCK_LABELS[type]}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
