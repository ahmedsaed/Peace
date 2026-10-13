import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap">
      <article className="prose">
        <h1>Nothing here.</h1>
        <p>
          That page does not exist. The <Link href="/">home page</Link> has everything else.
        </p>
      </article>
    </div>
  );
}
