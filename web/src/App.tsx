import { Button, Flex, Heading, Separator, Table, Text } from '@radix-ui/themes';
import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { Link } from 'react-router-dom';
import { Routes } from 'routes';

// Input data from the simulation
type DataFrame = Record<string, {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  mass?: number;
  energy?: number;
  time?: number;
}>;
type DataPoint = [number, number, DataFrame];

// Output data to the plot
type PlottedAgentData = {
  name: string;
  x: number[];
  y: number[];
  z: number[];
  type: 'scatter3d';
  mode: 'lines+markers' | 'markers';
  marker: { size: number };
  line?: { width: number };
};
type PlottedFrame = Record<string, PlottedAgentData>;

const calculateSystemEnergy = (
  timeIndex: number,
  positionData: PlottedAgentData[],
  velocityData: PlottedAgentData[],
  massData: Record<string, (number | null)[]>,
  energyData: Record<string, (number | null)[]>
): number | null => {
  const bodies = positionData.flatMap((position) => {
    const velocity = velocityData.find((trace) => trace.name === position.name);
    const mass = massData[position.name]?.[timeIndex];
    const x = position.x[timeIndex];
    const y = position.y[timeIndex];
    const z = position.z[timeIndex];
    const vx = velocity?.x[timeIndex];
    const vy = velocity?.y[timeIndex];
    const vz = velocity?.z[timeIndex];

    if (
      typeof mass !== 'number' || !Number.isFinite(mass) ||
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof z !== 'number' || !Number.isFinite(z) ||
      typeof vx !== 'number' || !Number.isFinite(vx) ||
      typeof vy !== 'number' || !Number.isFinite(vy) ||
      typeof vz !== 'number' || !Number.isFinite(vz)
    ) {
      return [];
    }

    return [{ name: position.name, mass, x, y, z, vx, vy, vz }];
  });

  if (bodies.length !== positionData.length || bodies.length < 2) {
    return null;
  }

  let totalEnergy = 0;
  for (const body of bodies) {
    totalEnergy += 0.5 * body.mass * (body.vx ** 2 + body.vy ** 2 + body.vz ** 2);
  }

  for (let firstIndex = 0; firstIndex < bodies.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex++) {
      const first = bodies[firstIndex];
      const second = bodies[secondIndex];
      const distance = Math.hypot(
        first.x - second.x,
        first.y - second.y,
        first.z - second.z
      );
      if (distance === 0 || !Number.isFinite(distance)) return null;

      totalEnergy -= first.mass * second.mass / distance;
    }
  }

  if (Number.isFinite(totalEnergy)) return totalEnergy;

  const storedEnergies = positionData.map(
    ({ name }) => energyData[name]?.[timeIndex]
  );
  return storedEnergies.length > 0 &&
    storedEnergies.every(
      (energy): energy is number =>
        typeof energy === 'number' && Number.isFinite(energy)
    )
    ? storedEnergies.reduce((total, energy) => total + energy, 0)
    : null;
};

const App = () => {
  // Store plot data in state.
  const [positionData, setPositionData] = useState<PlottedAgentData[]>([]);
  const [velocityData, setVelocityData] = useState<PlottedAgentData[]>([]);
  const [massData, setMassData] = useState<Record<string, (number | null)[]>>({});
  const [energyData, setEnergyData] = useState<Record<string, (number | null)[]>>({});
  const [simulationTimes, setSimulationTimes] = useState<number[]>([]);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // fetch plot data when the component mounts
    let canceled = false;

    async function fetchData() {
      console.log('calling fetchdata...');

      try {
        // data should be populated from a POST call to the simulation server
        const response = await fetch('http://localhost:8000/simulation');
        if (canceled) return;
        const data: DataPoint[] = await response.json();

        const updatedPositionData: PlottedFrame = {};
        const updatedVelocityData: PlottedFrame = {};
        const updatedMassData: Record<string, (number | null)[]> = {};
        const updatedEnergyData: Record<string, (number | null)[]> = {};
        const updatedTimes: Record<string, number[]> = {};

        // NOTE: Uncomment to see the raw data in the console
        // console.log('Data:', data);

        const baseData = (agentId: string): PlottedAgentData => ({
          name: agentId,
          x: [],
          y: [],
          z: [],
          type: 'scatter3d',
          mode: 'lines+markers',
          marker: { size: 4 },
          line: { width: 2 },
        });

        data.forEach(([t0, t1, frame]) => {
          for (let [agentId, val] of Object.entries(frame)) {
              if (agentId == "time" || agentId == "timeStep") {
                continue;
              }
              let {position, velocity} = val;
              updatedPositionData[agentId] = updatedPositionData[agentId] || baseData(agentId);
              updatedPositionData[agentId].x.push(position.x);
              updatedPositionData[agentId].y.push(position.y);
              updatedPositionData[agentId].z.push(position.z);

              updatedVelocityData[agentId] = updatedVelocityData[agentId] || baseData(agentId);
              updatedVelocityData[agentId].x.push(velocity.x);
              updatedVelocityData[agentId].y.push(velocity.y);
              updatedVelocityData[agentId].z.push(velocity.z);

              updatedMassData[agentId] = updatedMassData[agentId] || [];
              updatedMassData[agentId].push(
                typeof val.mass === 'number' ? val.mass : null
              );

              updatedEnergyData[agentId] = updatedEnergyData[agentId] || [];
              updatedEnergyData[agentId].push(
                typeof val.energy === 'number' ? val.energy : null
              );
              if (typeof val.time === 'number') {
                updatedTimes[agentId] = updatedTimes[agentId] || [];
                updatedTimes[agentId].push(val.time);
              }
          }
        });
        setPositionData(Object.values(updatedPositionData));
        setVelocityData(Object.values(updatedVelocityData));
        setMassData(updatedMassData);
        setEnergyData(updatedEnergyData);
        setSimulationTimes(Object.values(updatedTimes)[0] ?? []);
        setSelectedTimeIndex(Math.max(0, data.length - 1));
        console.log('Set plot data!');
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    }

    fetchData();

    return () => {
      canceled = true;
    };
  }, []);

  const maxTimeIndex = Math.max(positionData[0]?.x.length ?? 0, velocityData[0]?.x.length ?? 0, 0) - 1;

  useEffect(() => {
    if (maxTimeIndex >= 0) {
      setSelectedTimeIndex((prev) => Math.min(prev, maxTimeIndex));
    }
  }, [maxTimeIndex]);

  useEffect(() => {
    if (!isPlaying) return;

    const intervalId = window.setInterval(() => {
      setSelectedTimeIndex((currentIndex) => {
        if (currentIndex >= maxTimeIndex) {
          setIsPlaying(false);
          return currentIndex;
        }
        return currentIndex + 1;
      });
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [isPlaying, maxTimeIndex]);

  const selectedPositionData = useMemo(() => {
    if (!positionData.length) return [];
    return positionData.map((trace): PlottedAgentData => ({
      ...trace,
      x: trace.x.slice(0, selectedTimeIndex + 1),
      y: trace.y.slice(0, selectedTimeIndex + 1),
      z: trace.z.slice(0, selectedTimeIndex + 1),
    }));
  }, [positionData, selectedTimeIndex]);

  const selectedVelocityData = useMemo(() => {
    if (!velocityData.length) return [];
    return velocityData.map((trace): PlottedAgentData => ({
      ...trace,
      x: [trace.x[selectedTimeIndex]],
      y: [trace.y[selectedTimeIndex]],
      z: [trace.z[selectedTimeIndex]],
      mode: 'markers',
      marker: { size: 8 },
      line: undefined,
    }));
  }, [velocityData, selectedTimeIndex]);

  const energyReadings = useMemo(() => {
    const getEnergyAt = (timeIndex: number) =>
      calculateSystemEnergy(timeIndex, positionData, velocityData, massData, energyData);

    const initial = getEnergyAt(0);
    const selected = getEnergyAt(selectedTimeIndex);

    return {
      selected,
      initial,
      percentDifference:
        initial !== null && selected !== null && initial !== 0
          ? (Math.abs(selected - initial) / Math.abs(initial)) * 100
          : null,
    };
  }, [energyData, massData, maxTimeIndex, positionData, selectedTimeIndex, velocityData]);

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        margin: '0 auto',
      }}
    >
      {/* Flex: https://www.radix-ui.com/themes/docs/components/flex */}
      <Flex direction="column" m="4" width="100%" justify="center" align="center">
        <Heading as="h1" size="8" weight="bold" mb="4">
          Simulation Data
        </Heading>
        <Link to={Routes.FORM}>Define new simulation parameters</Link>
        <Separator size="4" my="5" />
        <Flex direction="column" align="center" width="100%" mb="4">
          <Text as="label" size="3" weight="medium">
            Time step: {selectedTimeIndex + 1} / {Math.max(maxTimeIndex + 1, 1)}
            {simulationTimes[selectedTimeIndex] !== undefined
              ? `  (t = ${simulationTimes[selectedTimeIndex].toFixed(2)})`
              : ''}
          </Text>
          <Button
            type="button"
            mt="2"
            disabled={maxTimeIndex <= 0}
            onClick={() => {
              if (isPlaying) {
                setIsPlaying(false);
              } else {
                if (selectedTimeIndex >= maxTimeIndex) setSelectedTimeIndex(0);
                setIsPlaying(true);
              }
            }}
          >
            {isPlaying ? 'Pause position playback' : 'Play position'}
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(maxTimeIndex, 0)}
            value={Math.min(selectedTimeIndex, Math.max(maxTimeIndex, 0))}
            onChange={(event) => {
              setIsPlaying(false);
              setSelectedTimeIndex(Number(event.target.value));
            }}
            style={{ width: '60%', marginTop: '8px' }}
          />
          <Text size="3" weight="bold" mt="2">
            Total system energy:{' '}
            {energyReadings.selected === null
              ? 'Unavailable'
              : energyReadings.selected.toExponential(6)}
          </Text>
          <Text size="2" mt="1">
            Energy difference from initial:{' '}
            {energyReadings.percentDifference === null
              ? 'Unavailable'
              : `${energyReadings.percentDifference.toFixed(4)}%`}
          </Text>
        </Flex>
        <Flex direction="row" width="100%" justify="center">
          <Plot
            style={{ width: '45%', height: '100%', margin: '5px' }}
            data={selectedPositionData.length ? selectedPositionData : positionData}
            layout={{
              title: 'Position',
              scene: {
                xaxis: { title: 'X' },
                yaxis: { title: 'Y' },
                zaxis: { title: 'Z' },
              },
              autosize: true,
              dragmode: 'turntable',
            }}
            useResizeHandler
            config={{
              scrollZoom: true,
            }}
          />
          <Plot
            style={{ width: '45%', height: '100%', margin: '5px' }}
            data={selectedVelocityData.length ? selectedVelocityData : velocityData}
            layout={{
              title: 'Velocity',
              scene: {
                xaxis: { title: 'X' },
                yaxis: { title: 'Y' },
                zaxis: { title: 'Z' },
              },
              autosize: true,
              dragmode: 'turntable',
            }}
            useResizeHandler
            config={{
              scrollZoom: true,
            }}
          />
        </Flex>
        <Flex justify="center" width="100%" m="4">
          <Table.Root style={{ width: '800px' }}>
            {/* Table: https://www.radix-ui.com/themes/docs/components/table */}
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Agent</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Position (x, y, z)</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Velocity (x, y, z)</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {positionData.map((position) => {
                const velocity = velocityData.find(
                  (trace) => trace.name === position.name
                );
                const formatVector = (trace?: PlottedAgentData) =>
                  trace
                    ? `(${trace.x[selectedTimeIndex]?.toFixed(4) ?? '-'}, ${trace.y[selectedTimeIndex]?.toFixed(4) ?? '-'}, ${trace.z[selectedTimeIndex]?.toFixed(4) ?? '-'})`
                    : '-';

                return (
                  <Table.Row key={position.name}>
                    <Table.RowHeaderCell>{position.name}</Table.RowHeaderCell>
                    <Table.Cell>{formatVector(position)}</Table.Cell>
                    <Table.Cell>{formatVector(velocity)}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Flex>
      </Flex>
    </div>
  );
};

export default App;
