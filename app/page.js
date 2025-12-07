import Link from "next/link";

const HomePage = () => {
  return (
    <div className="hero min-h-screen bg-base-200">
      <div className="hero-content text-center">
        <div className="max-w-md">
          <h1 className="text-6xl font-bold text-primary">TravelPlanner</h1>
          <p className="py-6 text-lg leading-loose">
            Plan your perfect trip with AI-powered itinerary generation. Create
            detailed travel plans with top attractions, hotels, and daily
            schedules. Save your trips and access them anytime from the cloud.
            <br />
            *Click Get Started to begin planning your next adventure.
          </p>
          <Link
            href="/planner"
            className="btn btn-secondary"
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
};
export default HomePage;
