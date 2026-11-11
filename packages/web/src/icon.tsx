import { icon } from '@cartography/icons';

/** A Lucide icon from the same pack the diagrams use. */
export function Icon({ name, size = 16, stroke = 1.5 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon(name) ?? '' }}
    />
  );
}
