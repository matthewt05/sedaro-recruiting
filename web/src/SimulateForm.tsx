import { Form, FormField, FormLabel } from '@radix-ui/react-form';
import { Button, Card, Flex, Heading, Separator, Text, TextField } from '@radix-ui/themes';
import _ from 'lodash';
import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Routes } from 'routes';

type FormValue = number | '';
interface FormData {
  startTime: FormValue;
  endTime: FormValue;
  timeStep: FormValue;
  Body1: {
    position: {
      x: FormValue;
      y: FormValue;
      z: FormValue;
    }
    velocity: {
      x: FormValue;
      y: FormValue;
      z: FormValue;
    }
    mass: FormValue;
  };
  Body2: {
    position: {
      x: FormValue;
      y: FormValue;
      z: FormValue;
    }
    velocity: {
      x: FormValue;
      y: FormValue;
      z: FormValue;
    }
    mass: FormValue;
  };
}

const SimulateForm: React.FC = () => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState('');
  const [analysisTimeSteps, setAnalysisTimeSteps] = useState('0.01, 0.02, 0.05, 0.1, 0.2');
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    startTime: 0,
    endTime: 5,
    timeStep: 0.01,
    Body1: { position: {x: -0.73, y: 0, z: 0}, velocity: {x: 0, y: -0.0015, z: 0}, mass: 1 },
    Body2: { position: {x: 60.34, y: 0, z: 0}, velocity: {x: 0, y: 0.13, z: 0}, mass: 0.0123 },
  });

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let newValue: FormValue = value === '' ? '' : parseFloat(value);
    setFormData((prev) => _.set({ ...prev }, name, newValue));
    setErrorMessage('');
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const startTime = formData.startTime;
      const endTime = formData.endTime;
      const timeStep = formData.timeStep;
      if (typeof startTime !== 'number' || !Number.isFinite(startTime)) {
        setErrorMessage('Start time must be a finite number.');
        return;
      }
      if (typeof endTime !== 'number' || !Number.isFinite(endTime) || endTime <= startTime) {
        setErrorMessage('End time must be finite and greater than start time.');
        return;
      }
      if (typeof timeStep !== 'number' || !Number.isFinite(timeStep) || timeStep <= 0) {
        setErrorMessage('Time step must be a finite number greater than zero.');
        return;
      }

      try {
        const response = await fetch('http://localhost:8000/simulation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...formData, startTime, endTime, timeStep }),
        });
        if (!response.ok) {
          throw new Error((await response.text()) || `Request failed (${response.status}).`);
        }
        navigate(Routes.SIMULATION);
      } catch (error) {
        console.error('Error:', error);
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start simulation.');
      }
    },
    [formData]
  );

  const handleStartAnalysis = useCallback(async () => {
    const startTime = formData.startTime;
    const endTime = formData.endTime;
    if (typeof startTime !== 'number' || !Number.isFinite(startTime)) {
      setErrorMessage('Start time must be a finite number.');
      return;
    }
    if (typeof endTime !== 'number' || !Number.isFinite(endTime) || endTime <= startTime) {
      setErrorMessage('End time must be finite and greater than start time.');
      return;
    }

    const entries = analysisTimeSteps.split(',').map((value) => value.trim());
    if (entries.length === 0 || entries.some((value) => value === '')) {
      setErrorMessage('Enter one or more comma-separated timestep values.');
      return;
    }
    const timeSteps = entries.map(Number);
    if (timeSteps.some((value) => !Number.isFinite(value) || value <= 0)) {
      setErrorMessage('Each timestep must be a finite number greater than zero.');
      return;
    }
    if (new Set(timeSteps).size !== timeSteps.length) {
      setErrorMessage('Timestep values must be different.');
      return;
    }

    const invalidBody = [formData.Body1, formData.Body2].some((body) => {
      const values = [
        ...Object.values(body.position),
        ...Object.values(body.velocity),
        body.mass,
      ];
      return values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
        || typeof body.mass !== 'number'
        || body.mass <= 0;
    });
    if (invalidBody) {
      setErrorMessage('Body values must be finite, and masses must be greater than zero.');
      return;
    }

    setErrorMessage('');
    setIsStartingAnalysis(true);
    try {
      const response = await fetch('http://localhost:8000/simulation/timestep-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime,
          endTime,
          timeSteps,
          Body1: formData.Body1,
          Body2: formData.Body2,
        }),
      });
      const result = await response.json() as { jobId?: unknown; error?: string };
      if (!response.ok) {
        throw new Error(result.error || `Request failed (${response.status}).`);
      }
      if (typeof result.jobId !== 'string') {
        throw new Error('The server did not return an analysis job ID.');
      }
      navigate(`${Routes.TIMESTEP_ANALYSIS}/${result.jobId}`);
    } catch (error) {
      console.error('Error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start timestep analysis.');
    } finally {
      setIsStartingAnalysis(false);
    }
  }, [analysisTimeSteps, formData, navigate]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '5%',
        left: 'calc(50% - 200px)',
        overflow: 'scroll',
      }}
    >
      {/* Card: https://www.radix-ui.com/themes/docs/components/card */}
      <Card
        style={{
          width: '400px',
        }}
      >
        <Heading as="h2" size="4" weight="bold" mb="4">
          Run a Simulation
        </Heading>
        <Link to={Routes.SIMULATION}>View previous simulation</Link>
        <Separator size="4" my="5" />
        <Form onSubmit={handleSubmit}>
          <FormField name="startTime">
            <FormLabel htmlFor="startTime">Start time (simulation units)</FormLabel>
            <TextField.Root
              type="number"
              id="startTime"
              name="startTime"
              value={formData.startTime}
              onChange={handleChange}
              step="any"
              required
            />
          </FormField>
          <FormField name="endTime">
            <FormLabel htmlFor="endTime">End time (simulation units)</FormLabel>
            <TextField.Root
              type="number"
              id="endTime"
              name="endTime"
              value={formData.endTime}
              onChange={handleChange}
              step="any"
              required
            />
          </FormField>
          <FormField name="timeStep">
            <FormLabel htmlFor="timeStep">Time step (simulation units)</FormLabel>
            <TextField.Root
              type="number"
              id="timeStep"
              name="timeStep"
              value={formData.timeStep}
              onChange={handleChange}
              min="0"
              step="any"
              required
            />
          </FormField>
          {errorMessage && (
            <Text color="red" role="alert" mt="2">
              {errorMessage}
            </Text>
          )}
          {/* 
            *********************************
            Body1
            *********************************
            */}
          <Heading as="h3" size="3" weight="bold">
            Body1
          </Heading>
          {/* Form: https://www.radix-ui.com/primitives/docs/components/form */}
          <FormField name="Body1.position.x">
            <FormLabel htmlFor="Body1.position.x">Initial X-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.position.x"
              name="Body1.position.x"
              value={formData.Body1.position.x}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.position.y">
            <FormLabel htmlFor="Body1.position.y">Initial Y-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.position.y"
              name="Body1.position.y"
              value={formData.Body1.position.y}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.position.z">
            <FormLabel htmlFor="Body1.position.z">Initial Z-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.position.z"
              name="Body1.position.z"
              value={formData.Body1.position.z}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.velocity.x">
            <FormLabel htmlFor="Body1.velocity.x">Initial X-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.velocity.x"
              name="Body1.velocity.x"
              value={formData.Body1.velocity.x}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.velocity.y">
            <FormLabel htmlFor="Body1.velocity.y">Initial Y-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.velocity.y"
              name="Body1.velocity.y"
              value={formData.Body1.velocity.y}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.velocity.z">
            <FormLabel htmlFor="Body1.velocity.z">Initial Z-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.velocity.z"
              name="Body1.velocity.z"
              value={formData.Body1.velocity.z}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body1.mass">
            <FormLabel htmlFor="Body1.mass">Mass</FormLabel>
            <TextField.Root
              type="number"
              id="Body1.mass"
              name="Body1.mass"
              value={formData.Body1.mass}
              onChange={handleChange}
              required
            />
          </FormField>
          {/* 
            *********************************
            Body2
            *********************************
             */}
          <Heading as="h3" size="3" weight="bold" mt="4">
            Body2
          </Heading>
          <FormField name="Body2.position.x">
            <FormLabel htmlFor="Body2.position.x">Initial X-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.position.x"
              name="Body2.position.x"
              value={formData.Body2.position.x}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.position.y">
            <FormLabel htmlFor="Body2.position.y">Initial Y-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.position.y"
              name="Body2.position.y"
              value={formData.Body2.position.y}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.position.z">
            <FormLabel htmlFor="Body2.position.z">Initial Z-position</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.position.z"
              name="Body2.position.z"
              value={formData.Body2.position.z}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.velocity.x">
            <FormLabel htmlFor="Body2.velocity.x">Initial X-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.velocity.x"
              name="Body2.velocity.x"
              value={formData.Body2.velocity.x}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.velocity.y">
            <FormLabel htmlFor="Body2.velocity.y">Initial Y-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.velocity.y"
              name="Body2.velocity.y"
              value={formData.Body2.velocity.y}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.velocity.z">
            <FormLabel htmlFor="Body2.velocity.z">Initial Z-velocity</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.velocity.z"
              name="Body2.velocity.z"
              value={formData.Body2.velocity.z}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField name="Body2.mass">
            <FormLabel htmlFor="Body2.mass">Mass</FormLabel>
            <TextField.Root
              type="number"
              id="Body2.mass"
              name="Body2.mass"
              value={formData.Body2.mass}
              onChange={handleChange}
              required
            />
          </FormField>
          <Separator size="4" my="5" />
          <Heading as="h3" size="3" weight="bold">
            Maximum Energy Error Analysis
          </Heading>
          <Text as="p" size="2" color="gray" mt="2">
            Enter any number of different timesteps. The runs will execute sequentially in the background;
            you can close this page while they run.
          </Text>
          <FormField name="analysisTimeSteps">
            <FormLabel htmlFor="analysisTimeSteps">Timesteps (comma-separated)</FormLabel>
            <TextField.Root
              type="text"
              id="analysisTimeSteps"
              name="analysisTimeSteps"
              value={analysisTimeSteps}
              onChange={(event) => {
                setAnalysisTimeSteps(event.target.value);
                setErrorMessage('');
              }}
              placeholder="0.01, 0.02, 0.05, 0.1, 0.2"
            />
          </FormField>
          <Text as="p" size="1" color="gray" mt="1">
            Only each timestep and its maximum absolute energy error percentage are saved.
          </Text>
          <Flex justify="center" mt="4">
            <Button type="button" onClick={handleStartAnalysis} disabled={isStartingAnalysis}>
              {isStartingAnalysis ? 'Starting...' : 'Start analysis'}
            </Button>
          </Flex>
          <Flex justify="center" m="5">
            <Button type="submit" disabled={isStartingAnalysis}>Submit</Button>
          </Flex>
        </Form>
      </Card>
    </div>
  );
};

export default SimulateForm;
