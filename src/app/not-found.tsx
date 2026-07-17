import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-stage" id="main-content">
      <span className="error-stage__kicker">The path dissolved</span>
      <h1>This chamber is not part of the studio.</h1>
      <p>Return to the Atrium to find your Series, Episodes and reviews.</p>
      <Link className="primary-button" href="/">
        Return to Atrium
      </Link>
    </main>
  );
}
