import React from 'react';
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
  return (
    <div className="grid grid-cols-3 gap-2">
      {value.map((item, index) => (
        <div key={labels[index]}>
          <span className="mb-1 block text-[10px] font-medium text-zinc-500">{labels[index]}</span>
          <TextInput
            type="number"
            step={step}
            value={Number(item.toFixed(3))}
            onChange={(event) => {
              const next = [...value] as Vec3;
              next[index] = Number(event.target.value);
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
