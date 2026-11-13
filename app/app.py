# HTTP SERVER

import json
import logging
import math
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Lock

from flask import Flask, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from simulator import Simulator
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from store import QRangeStore

class Base(DeclarativeBase):
    pass


############################## Application Configuration ##############################

app = Flask(__name__)
CORS(app, origins=["http://localhost:3030"])

db = SQLAlchemy(model_class=Base)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///database.db"
db.init_app(app)

logging.basicConfig(level=logging.INFO)

############################## Database Models ##############################


class Simulation(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[str]


class TimestepAnalysisResult(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[str] = mapped_column(index=True)
    time_step: Mapped[float]
    max_energy_error_percent: Mapped[float]


with app.app_context():
    db.create_all()

analysis_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="timestep-analysis")
analysis_jobs = {}
analysis_jobs_lock = Lock()


############################## API Endpoints ##############################


@app.get("/")
def health():
    return "<p>Sedaro Nano API - running!</p>"


@app.get("/simulation")
def get_data():
    # Get most recent simulation from database
    simulation: Simulation = Simulation.query.order_by(Simulation.id.desc()).first()
    return simulation.data if simulation else []


@app.post("/simulation")
def simulate():
    # Get data from request in this form
    # init = {
    #     "Body1": {"x": 0, "y": 0.1, "vx": 0.1, "vy": 0},
    #     "Body2": {"x": 0, "y": 1, "vx": 1, "vy": 0},
    # }

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return {"error": "Expected a JSON object."}, 400

    numeric_parameters = {}
    for name, default in (("startTime", 0.0), ("endTime", 5.0), ("timeStep", 0.01)):
        value = payload.get(name, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return {"error": f"{name} must be a finite number."}, 400
        try:
            value = float(value)
        except OverflowError:
            return {"error": f"{name} must be a finite number."}, 400
        if not math.isfinite(value):
            return {"error": f"{name} must be a finite number."}, 400
        numeric_parameters[name] = value

    start_time = numeric_parameters["startTime"]
    end_time = numeric_parameters["endTime"]
    time_step = numeric_parameters["timeStep"]
    if end_time <= start_time:
        return {"error": "endTime must be greater than startTime."}, 400
    if time_step <= 0:
        return {"error": "timeStep must be greater than zero."}, 400

    init: dict = {
        key: state
        for key, state in payload.items()
        if key not in {"startTime", "endTime", "timeStep", "maxSteps"}
    }
    if not init or any(not isinstance(state, dict) for state in init.values()):
        return {"error": "Simulation agents must be provided as JSON objects."}, 400

    for state in init.values():
        state["time"] = start_time
        state["timeStep"] = time_step

    # Create store and simulator
    t = datetime.now()
    store = QRangeStore()
    simulator = Simulator(store=store, init=init)
    logging.info(f"Time to Build: {datetime.now() - t}")

    # Run simulation
    t = datetime.now()
    simulator.simulate_until(end_time)
    logging.info(f"Time to Simulate: {datetime.now() - t}")

    # Save data to database
    simulation = Simulation(data=json.dumps(store.store))
    db.session.add(simulation)
    db.session.commit()

    return store.store


def _finite_number(value, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number.")
    try:
        number = float(value)
    except OverflowError:
        raise ValueError(f"{name} must be a finite number.") from None
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number.")
    return number


def _total_system_energy(bodies: dict) -> tuple[float, float]:
    states = []
    for name in ("Body1", "Body2"):
        body = bodies.get(name)
        if not isinstance(body, dict):
            raise ValueError(f"{name} state is required.")

        mass = _finite_number(body.get("mass"), f"{name} mass")
        if mass <= 0:
            raise ValueError(f"{name} mass must be greater than zero.")

        state = {"mass": mass}
        for field in ("position", "velocity"):
            vector = body.get(field)
            if not isinstance(vector, dict):
                raise ValueError(f"{name} {field} must have x, y, and z components.")
            state[field] = {
                axis: _finite_number(vector.get(axis), f"{name} {field}.{axis}")
                for axis in ("x", "y", "z")
            }
        states.append(state)

    first, second = states
    distance = math.dist(
        (first["position"]["x"], first["position"]["y"], first["position"]["z"]),
        (second["position"]["x"], second["position"]["y"], second["position"]["z"]),
    )
    if distance == 0:
        raise ValueError("Cannot calculate energy for bodies at the same position.")

    kinetic_energies = [
        0.5 * state["mass"] * sum(component * component for component in state["velocity"].values())
        for state in states
    ]
    potential_energy = -first["mass"] * second["mass"] / distance
    energy = sum(kinetic_energies) + potential_energy
    if not math.isfinite(energy):
        raise ValueError("The total system energy is not finite.")
    energy_scale = max(
        abs(kinetic_energies[0]),
        abs(kinetic_energies[1]),
        abs(potential_energy),
    )
    return energy, energy_scale


def _run_timestep_analysis(payload: dict) -> list[dict]:
    start_time = payload["startTime"]
    end_time = payload["endTime"]
    initial_energy, initial_energy_scale = _total_system_energy(payload)
    if abs(initial_energy) <= 16 * math.ulp(1.0) * initial_energy_scale:
        raise ValueError("Relative energy error cannot be calculated when initial energy is zero or near zero.")

    results = []
    for time_step in payload["timeSteps"]:
        init = {
            name: {**payload[name], "time": start_time, "timeStep": time_step}
            for name in ("Body1", "Body2")
        }
        store = QRangeStore()
        simulator = Simulator(store=store, init=init)
        simulator.simulate_until(end_time)

        states_by_time = {}
        for low, high, frame in store.store:
            if high > start_time:
                states_by_time.setdefault(high, {}).update(frame)

        energy_errors = []
        for states in states_by_time.values():
            current_energy, _ = _total_system_energy(states)
            error_percent = abs(current_energy - initial_energy) / abs(initial_energy) * 100
            if not math.isfinite(error_percent):
                raise ValueError("The relative energy error is not finite.")
            energy_errors.append(error_percent)
        if not energy_errors:
            raise ValueError(f"Timestep {time_step:g} produced no completed steps.")

        results.append({
            "timeStep": time_step,
            "maxEnergyErrorPercent": max(energy_errors),
        })
    return results


def _execute_timestep_analysis(job_id: str, payload: dict) -> None:
    with analysis_jobs_lock:
        analysis_jobs[job_id] = {"status": "running"}

    try:
        results = _run_timestep_analysis(payload)
        with app.app_context():
            db.session.add_all([
                TimestepAnalysisResult(
                    job_id=job_id,
                    time_step=result["timeStep"],
                    max_energy_error_percent=result["maxEnergyErrorPercent"],
                )
                for result in results
            ])
            db.session.commit()
        with analysis_jobs_lock:
            analysis_jobs[job_id] = {"status": "completed"}
    except Exception as error:
        logging.exception("Timestep analysis job %s failed.", job_id)
        with app.app_context():
            db.session.rollback()
        with analysis_jobs_lock:
            analysis_jobs[job_id] = {"status": "failed", "error": str(error)}


def _saved_analysis_results(job_id: str) -> list[dict]:
    rows = (
        TimestepAnalysisResult.query
        .filter_by(job_id=job_id)
        .order_by(TimestepAnalysisResult.id)
        .all()
    )
    return [
        {
            "timeStep": row.time_step,
            "maxEnergyErrorPercent": row.max_energy_error_percent,
        }
        for row in rows
    ]


@app.post("/simulation/timestep-analysis")
def start_timestep_analysis():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return {"error": "Expected a JSON object."}, 400

    try:
        start_time = _finite_number(payload.get("startTime"), "startTime")
        end_time = _finite_number(payload.get("endTime"), "endTime")
    except ValueError as error:
        return {"error": str(error)}, 400
    if end_time <= start_time:
        return {"error": "endTime must be greater than startTime."}, 400

    time_steps = payload.get("timeSteps")
    if not isinstance(time_steps, list) or not time_steps:
        return {"error": "Enter at least one timestep value."}, 400
    try:
        time_steps = [_finite_number(value, "Each timestep") for value in time_steps]
    except ValueError as error:
        return {"error": str(error)}, 400
    if any(value <= 0 for value in time_steps):
        return {"error": "Each timestep must be greater than zero."}, 400
    if len(set(time_steps)) != len(time_steps):
        return {"error": "Timestep values must be different."}, 400

    initial_states = {name: payload.get(name) for name in ("Body1", "Body2")}
    try:
        initial_energy, initial_energy_scale = _total_system_energy(initial_states)
    except ValueError as error:
        return {"error": str(error)}, 400
    if abs(initial_energy) <= 16 * math.ulp(1.0) * initial_energy_scale:
        return {"error": "Relative energy error cannot be calculated when initial energy is zero or near zero."}, 400

    job_id = uuid.uuid4().hex
    job_payload = {
        "startTime": start_time,
        "endTime": end_time,
        "timeSteps": time_steps,
        **initial_states,
    }
    with analysis_jobs_lock:
        analysis_jobs[job_id] = {"status": "queued"}
    analysis_executor.submit(_execute_timestep_analysis, job_id, job_payload)
    return {"jobId": job_id, "status": "queued"}, 202


@app.get("/simulation/timestep-analysis/<job_id>")
def get_timestep_analysis(job_id: str):
    with analysis_jobs_lock:
        job = analysis_jobs.get(job_id)
    if job is None:
        if not _saved_analysis_results(job_id):
            return {"error": "Analysis job was not found."}, 404
        job = {"status": "completed"}

    response = {"jobId": job_id, **job}
    if job["status"] == "completed":
        response["results"] = _saved_analysis_results(job_id)
    return response
