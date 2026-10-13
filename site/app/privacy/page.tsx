import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Peace keeps on your phone, what it can send and to whom, and how to delete it.',
};

export default function Privacy() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('privacy') }} />
    </div>
  );
}
