import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <>
      <h1>Sidan finns inte</h1>
      <p>
        <Link to="/">Till startsidan</Link>
      </p>
    </>
  );
}
