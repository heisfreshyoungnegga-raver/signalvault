import { createFileRoute } from "@tanstack/react-router";
import { SimulationLab } from "@/components/predictor/SimulationLab";

export const Route = createFileRoute("/predictor/simulate")({
  component: SimulationLab,
});
