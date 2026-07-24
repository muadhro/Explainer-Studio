interface LegalProps {
  title: string;
}

export default function Legal({ title }: LegalProps) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <div className="legal-body">
        <p>
          This is placeholder content. Replace this page with your actual{' '}
          {title.toLowerCase()} before launching this app to real users.
        </p>
        <p>Last updated: —</p>
      </div>
    </div>
  );
}
