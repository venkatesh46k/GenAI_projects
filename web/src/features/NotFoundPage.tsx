import { Link } from "react-router-dom";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        hint="The page you are looking for does not exist or has moved."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/customers">Go to customers</Link>
          </Button>
        }
      />
    </Card>
  );
}
