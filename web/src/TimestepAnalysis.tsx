import { Button, Card, Flex, Heading, Table, Text } from '@radix-ui/themes';
import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { Link, useParams } from 'react-router-dom';
import { Routes } from 'routes';

interface TimestepResult {
  timeStep: number;
  maxEnergyErrorPercent: number;
}

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

const TimestepAnalysis: React.FC = () => {
  const { jobId } = useParams();
  const [status, setStatus] = useState<JobStatus>('queued');
  const [results, setResults] = useState<TimestepResult[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (!jobId) {
        setErrorMessage('No analysis job was specified.');
        return;
      }

      try {
        const response = await fetch(`http://localhost:8000/simulation/timestep-analysis/${jobId}`);
        const result = await response.json() as {
          status?: JobStatus;
          results?: TimestepResult[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || `Request failed (${response.status}).`);
        }
        if (cancelled) return;

        if (!result.status) {
          throw new Error('The server returned an invalid job status.');
        }
        setStatus(result.status);
        if (result.status === 'completed') {
          setResults(result.results ?? []);
        } else if (result.status === 'failed') {
          setErrorMessage(result.error || 'The analysis failed.');
        } else {
          timer = window.setTimeout(poll, 1000);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to retrieve analysis status.');
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId]);

  const sortedResults = [...results].sort((a, b) => a.timeStep - b.timeStep);

  return (
    <div style={{ maxWidth: '960px', margin: '32px auto', padding: '16px' }}>
      <Card>
        <Flex direction="column" gap="4">
          <Heading as="h1" size="6">
            Maximum Energy Error by Timestep
          </Heading>
          <Text>
            Job status: {status}
            {status === 'queued' || status === 'running'
              ? '. The simulations run sequentially in the background.'
              : ''}
          </Text>
          <Text size="2" color="gray">
            Error is the maximum over completed timesteps of |E(t) - E0| / |E0| * 100%.
            The initial state is excluded.
          </Text>
          {errorMessage && <Text color="red" role="alert">{errorMessage}</Text>}
          {status === 'completed' && results.length > 0 && (
            <>
              <Plot
                data={[{
                  x: sortedResults.map((result) => result.timeStep),
                  y: sortedResults.map((result) => result.maxEnergyErrorPercent),
                  type: 'scatter',
                  mode: 'lines+markers',
                  name: 'Maximum energy error',
                }]}
                layout={{
                  title: { text: 'Timestep vs Maximum Energy Error' },
                  xaxis: { title: { text: 'Timestep (simulation units)' }, type: 'linear' },
                  yaxis: { title: { text: 'Maximum energy error (%)' } },
                  autosize: true,
                  margin: { t: 60, r: 24, b: 70, l: 80 },
                }}
                useResizeHandler
                style={{ width: '100%', height: '450px' }}
                config={{ responsive: true, displayModeBar: false }}
              />
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Time step</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Maximum energy error (%)</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {results.map((result, index) => (
                    <Table.Row key={`${result.timeStep}-${index}`}>
                      <Table.Cell>{result.timeStep}</Table.Cell>
                      <Table.Cell>{result.maxEnergyErrorPercent.toExponential(6)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </>
          )}
          {status === 'completed' && results.length === 0 && (
            <Text color="red">The job completed without returning results.</Text>
          )}
          <Flex>
            <Button asChild>
              <Link to={Routes.FORM}>Back to simulation form</Link>
            </Button>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
};

export default TimestepAnalysis;