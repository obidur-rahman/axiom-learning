'use client';

import { Switch } from './ui/switch';

interface ToggleProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** One settings switch: title, explanation and a real shadcn Switch. */
export function Toggle({ id, label, description, checked, onCheckedChange }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[13.5px] font-medium">
          {label}
        </label>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
    </div>
  );
}
