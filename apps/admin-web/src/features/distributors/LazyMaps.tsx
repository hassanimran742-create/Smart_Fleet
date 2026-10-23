import { lazy, Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { StoreMapPickerProps, StoreThumbnailProps } from './StoreMapPicker';

/**
 * The store maps, loaded on first use: Leaflet and its tiles code stay out of the main bundle, and
 * the list, Today and Orders pages never wait for them. A skeleton in the map's shape shows meanwhile.
 */
const LazyPicker = lazy(async () => ({ default: (await import('./StoreMapPicker')).StoreMapPicker }));
const LazyThumbnail = lazy(async () => ({ default: (await import('./StoreMapPicker')).StoreThumbnail }));

export function StoreMapPicker(props: StoreMapPickerProps) {
  return (
    <Suspense fallback={<Skeleton height={340} radius="md" />}>
      <LazyPicker {...props} />
    </Suspense>
  );
}

export function StoreThumbnail(props: StoreThumbnailProps) {
  return (
    <Suspense fallback={<Skeleton height={160} radius="md" />}>
      <LazyThumbnail {...props} />
    </Suspense>
  );
}
