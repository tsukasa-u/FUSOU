import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bubble } from "react-chartjs-2";
import { faker } from "@faker-js/faker";

const randomName = faker.person.fullName(); // Rowan Nikolaus
const randomEmail = faker.internet.email(); // Kassandra.Haley@erich.biz

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

export const options = {
  scales: {
    y: {
      beginAtZero: true,
    },
  },
};

export const data = {
  datasets: [
    {
      label: "Red dataset",
      data: Array.from({ length: 50 }, () => ({
        x: faker.number.float({ min: -100, max: 100 }),
        y: faker.number.float({ min: -100, max: 100 }),
        r: faker.number.float({ min: 5, max: 20 }),
      })),
      backgroundColor: "rgba(255, 99, 132, 0.5)",
    },
    {
      label: "Blue dataset",
      data: Array.from({ length: 50 }, () => ({
        x: faker.number.float({ min: -100, max: 100 }),
        y: faker.number.float({ min: -100, max: 100 }),
        r: faker.number.float({ min: 5, max: 20 }),
      })),
      backgroundColor: "rgba(53, 162, 235, 0.5)",
    },
  ],
};

export function ChartComponent() {
  return (
    <>
      <div className="w-full">
        <Bubble options={options} data={data} width={500} height={500} />
      </div>
    </>
  );
}
