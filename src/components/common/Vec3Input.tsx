import React, { useId } from 'react';
import { Vec3 } from '../../domain/types';
import { TextInput } from './Field';

export function Vec3Input({
  value,
  onChange,
  step = 0.1,
  labels = ['X', 'Y', 'Z'],
}: {
  value: Vec3;
  onChange: (value: Vec3) => void;
  step?: number;
  labels?: [string, string, string];
}) {
  const baseId = useId();

  return (
    <div className="grid grid-cols-3 gap-2">
      {value.map((item, index) => {
        const inputId = `${baseId}-${labels[index]}`;
        return (
          <div key={labels[index]}>
            <label htmlFor={inputId} className="mb-1 block text-[10px] font-medium text-zinc-500">
              {labels[index]}
            </label>
            <TextInput
              id={inputId}
              type="number"
              step={step}
              value={Number(item.toFixed(3))}
              aria-label={labels[index]}
              onChange={(event) => {
                const next = [...value] as Vec3;
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
