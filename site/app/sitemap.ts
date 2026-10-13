import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/meta';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/data/', '/privacy/'].map((path) => ({ url: `${SITE_URL}${path}` }));
}
