// The mark: four corner ticks of a map sheet and the rust dot of "you are here".
import './brand-mark.css';

export function BrandMark({ size }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={size ? `brand-mark ${size}` : 'brand-mark'} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}
