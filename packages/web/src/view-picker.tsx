// The diagram's views, in the canvas tools: one drawing per view of the same file (context, containers…).
import { Icon } from './icon.tsx';

export interface ViewPickerProps {
  views?: { name: string; title?: string }[];
  /** The view drawn now; none is the diagram as written. */
  value?: string;
  /** Whether the diagram has something drawn as written, next to its views. */
  asWritten: boolean;
  onChange(view: string | undefined): void;
}

export function ViewPicker({ views, value, asWritten, onChange }: ViewPickerProps) {
  if (!views?.length) return null;
  return (
    <label className="tool view-picker" title="Views of this diagram (pins are kept per view)">
      <Icon name="layers" />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label="View">
        {asWritten && <option value="">As written</option>}
        {views.map((v) => (
          <option key={v.name} value={v.name}>
            {v.title ? `${v.title} (${v.name})` : v.name}
          </option>
        ))}
      </select>
    </label>
  );
}
