import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import {
  DEFAULT_HOME_BOOTSTRAP,
  DRIVER_STATUS_FLOW,
  SERVICE_NAME,
  type AuthSession,
  type CreateIncidentPayload,
  type CancelTripPayload,
  type DriverQueueSummary,
  type DriverTripStatusUpdate,
  type HomeBootstrap,
  type MapRegion,
  type RideEstimate,
  type RideEstimateRequest,
  type RidePoint,
  type RideTrip,
  type SignInPayload
} from "@diva-drive/domain";

const API_BASE_URL = "http://10.0.2.2:4000";
type AuthRole = SignInPayload["role"];

const api = async <T,>(
  path: string,
  session?: AuthSession,
  options?: RequestInit
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session
        ? {
            Authorization: `Bearer ${session.accessToken}`
          }
        : {}),
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(path);
  }

  return (await response.json()) as T;
};

const fallbackSession = (phone: string, role: AuthRole): AuthSession => ({
  accessToken: `demo-${role}-${phone.slice(-4) || "0000"}`,
  user: {
    id: `${role}-${phone.slice(-4) || "0000"}`,
    role,
    fullName: role === "driver" ? "Conductora Demo" : "Pasajera Demo",
    phone
  }
});

const nextStatusForTrip = (trip: RideTrip) => {
  if (trip.status === "matched") {
    return "driver_en_route";
  }

  const index = DRIVER_STATUS_FLOW.indexOf(
    trip.status as DriverTripStatusUpdate["status"]
  );
  return index >= 0 ? DRIVER_STATUS_FLOW[index + 1] ?? null : null;
};

const regionFromPoints = (origin: RidePoint, destination: RidePoint): MapRegion => ({
  latitude: (origin.latitude + destination.latitude) / 2,
  longitude: (origin.longitude + destination.longitude) / 2,
  latitudeDelta: Math.max(Math.abs(origin.latitude - destination.latitude), 0.02) * 2.2,
  longitudeDelta:
    Math.max(Math.abs(origin.longitude - destination.longitude), 0.02) * 2.2
});

const reportIncident = async (
  session: AuthSession,
  payload: CreateIncidentPayload
) => api("/incidents", session, {
  method: "POST",
  body: JSON.stringify(payload)
});

const cancelTrip = async (
  session: AuthSession,
  tripId: string,
  payload: CancelTripPayload
) => api<RideTrip>(`/trips/${tripId}/cancel`, session, {
  method: "POST",
  body: JSON.stringify(payload)
});

export default function App() {
  const [role, setRole] = useState<AuthRole>("passenger");
  const [phone, setPhone] = useState("999111222");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapRegion, setMapRegion] = useState<MapRegion>(DEFAULT_HOME_BOOTSTRAP.mapRegion);
  const [origin, setOrigin] = useState<RidePoint | null>(null);
  const [passengerHome, setPassengerHome] = useState<HomeBootstrap | null>(null);
  const [destination, setDestination] = useState<RidePoint | null>(null);
  const [estimate, setEstimate] = useState<RideEstimate | null>(null);
  const [activeTrip, setActiveTrip] = useState<RideTrip | null>(null);
  const [driverQueue, setDriverQueue] = useState<RideTrip[]>([]);
  const [driverHome, setDriverHome] = useState<DriverQueueSummary | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    let mounted = true;

    const bootstrap = async () => {
      setLoading(true);
      try {
        if (session.user.role === "passenger") {
          const [home, trip, permission] = await Promise.all([
            api<HomeBootstrap>("/home/passenger", session).catch(() => DEFAULT_HOME_BOOTSTRAP),
            api<{ trip: RideTrip | null }>("/trips/active", session).catch(() => ({ trip: null })),
            Location.requestForegroundPermissionsAsync()
          ]);

          if (!mounted) {
            return;
          }

          setPassengerHome(home);
          setActiveTrip(trip.trip);
          setDestination(trip.trip?.destination ?? home.suggestedDestinations[0] ?? null);
          setEstimate(trip.trip?.estimate ?? null);

          const fallbackOrigin: RidePoint = trip.trip?.origin ?? {
            label: "Punto de recojo",
            address: "Centro operativo inicial de DIVA DRIVE",
            latitude: home.mapRegion.latitude,
            longitude: home.mapRegion.longitude
          };

          if (permission.status === "granted") {
            const current = await Location.getCurrentPositionAsync({});
            if (!mounted) {
              return;
            }

            setOrigin(
              trip.trip?.origin ?? {
                label: "Ubicacion actual",
                address: "Posicion detectada por el dispositivo",
                latitude: current.coords.latitude,
                longitude: current.coords.longitude
              }
            );
          } else {
            setOrigin(fallbackOrigin);
          }
        } else {
          const [home, queue, trip] = await Promise.all([
            api<DriverQueueSummary>("/home/driver", session).catch(() => ({
              queueSize: 0,
              activeTrip: null
            })),
            api<{ trips: RideTrip[] }>("/driver/trips/queue", session).catch(() => ({ trips: [] })),
            api<{ trip: RideTrip | null }>("/trips/active", session).catch(() => ({ trip: null }))
          ]);

          if (!mounted) {
            return;
          }

          setDriverHome(home);
          setDriverQueue(queue.trips);
          setActiveTrip(trip.trip ?? home.activeTrip);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const timer = setInterval(() => {
      if (session.user.role === "passenger") {
        void api<{ trip: RideTrip | null }>("/trips/active", session)
          .then((payload) => setActiveTrip(payload.trip))
          .catch(() => undefined);
      } else {
        void Promise.all([
          api<{ trips: RideTrip[] }>("/driver/trips/queue", session).catch(() => ({ trips: [] })),
          api<{ trip: RideTrip | null }>("/trips/active", session).catch(() => ({ trip: null })),
          api<DriverQueueSummary>("/home/driver", session).catch(() => ({
            queueSize: 0,
            activeTrip: null
          }))
        ]).then(([queue, trip, home]) => {
          setDriverQueue(queue.trips);
          setActiveTrip(trip.trip ?? home.activeTrip);
          setDriverHome(home);
        });
      }
    }, 4000);

    return () => {
      clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (activeTrip) {
      setMapRegion(regionFromPoints(activeTrip.origin, activeTrip.destination));
    } else if (origin && destination) {
      setMapRegion(regionFromPoints(origin, destination));
    }
  }, [activeTrip, destination, origin]);

  const handleSignIn = async () => {
    if (phone.trim().length < 9) {
      Alert.alert("Telefono incompleto", "Ingresa un numero valido para continuar.");
      return;
    }

    setLoading(true);
    try {
      const nextSession = await api<AuthSession>("/auth/sign-in", undefined, {
        method: "POST",
        body: JSON.stringify({
          phone,
          role
        })
      }).catch(() => fallbackSession(phone, role));
      setSession(nextSession);
      setActiveTrip(null);
      setEstimate(null);
      setDriverQueue([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEstimate = async () => {
    if (!session || !origin || !destination) {
      return;
    }

    setLoading(true);
    try {
      const nextEstimate = await api<RideEstimate>("/trips/estimate", session, {
        method: "POST",
        body: JSON.stringify({
          origin,
          destination
        } satisfies RideEstimateRequest)
      });
      setEstimate(nextEstimate);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestTrip = async () => {
    if (!session || !origin || !destination) {
      return;
    }

    setLoading(true);
    try {
      const trip = await api<RideTrip>("/trips", session, {
        method: "POST",
        body: JSON.stringify({
          passengerId: session.user.id,
          passengerName: session.user.fullName,
          origin,
          destination
        })
      });
      setActiveTrip(trip);
      setEstimate(trip.estimate);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTrip = async (tripId: string) => {
    if (!session) {
      return;
    }

    setLoading(true);
    try {
      const trip = await api<RideTrip>(`/driver/trips/${tripId}/accept`, session, {
        method: "POST"
      });
      setActiveTrip(trip);
      setDriverQueue((current) => current.filter((item) => item.id !== tripId));
    } catch {
      Alert.alert("Solicitud no disponible", "Otra conductora pudo tomarla primero.");
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceTrip = async () => {
    if (!session || !activeTrip) {
      return;
    }

    const nextStatus = nextStatusForTrip(activeTrip);
    if (!nextStatus) {
      return;
    }

    setLoading(true);
    try {
      const trip = await api<RideTrip>(`/driver/trips/${activeTrip.id}/status`, session, {
        method: "POST",
        body: JSON.stringify({
          status: nextStatus
        } satisfies DriverTripStatusUpdate)
      });
      setActiveTrip(trip.status === "trip_completed" ? null : trip);
    } finally {
      setLoading(false);
    }
  };

  const handleReportIncident = async () => {
    if (!session || !activeTrip) {
      return;
    }

    setLoading(true);
    try {
      await reportIncident(session, {
        tripId: activeTrip.id,
        severity: "medium",
        category: "operacion",
        notes:
          session.user.role === "driver"
            ? "Incidencia reportada desde la app de conductora."
            : "Incidencia reportada desde la app de pasajera."
      });
      Alert.alert("Incidencia registrada", "Ya quedó visible en el panel operativo.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelTrip = async () => {
    if (!session || !activeTrip) {
      return;
    }

    setLoading(true);
    try {
      await cancelTrip(session, activeTrip.id, {
        reason:
          session.user.role === "driver"
            ? "Cancelacion operativa desde conductora"
            : "Cancelacion solicitada por pasajera"
      });
      setActiveTrip(null);
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.auth}>
          <Text style={styles.kicker}>DIVA DRIVE</Text>
          <Text style={styles.title}>{SERVICE_NAME}</Text>
          <Text style={styles.copy}>Acceso inicial para pasajera y conductora.</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              {(["passenger", "driver"] as const).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setRole(option)}
                  style={[styles.chip, role === option && styles.chipActive]}
                >
                  <Text style={role === option ? styles.chipTextActive : styles.chipText}>
                    {option === "passenger" ? "Pasajera" : "Conductora"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="999111222"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Pressable onPress={handleSignIn} style={styles.button}>
              <Text style={styles.buttonText}>
                Continuar como {role === "passenger" ? "pasajera" : "conductora"}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.shell}>
        <View style={styles.mapWrap}>
          <MapView style={styles.map} initialRegion={mapRegion} region={mapRegion}>
            {session.user.role === "passenger" && origin ? <Marker coordinate={origin} title={origin.label} description={origin.address} /> : null}
            {session.user.role === "passenger" && destination ? <Marker coordinate={destination} title={destination.label} description={destination.address} pinColor="#c54b23" /> : null}
            {activeTrip ? <Marker coordinate={activeTrip.origin} title={`Recojo - ${activeTrip.passengerName}`} description={activeTrip.origin.address} /> : null}
            {activeTrip ? <Marker coordinate={activeTrip.destination} title={`Destino - ${activeTrip.destination.label}`} description={activeTrip.destination.address} pinColor="#c54b23" /> : null}
            {activeTrip?.currentDriverLocation ? <Marker coordinate={activeTrip.currentDriverLocation} title={activeTrip.driverName ?? session.user.fullName} description="Ubicacion de la conductora" pinColor="#1d8f6a" /> : null}
          </MapView>
          <View style={styles.overlay}>
            <Text style={styles.kicker}>
              {session.user.role === "passenger" ? passengerHome?.city ?? DEFAULT_HOME_BOOTSTRAP.city : DEFAULT_HOME_BOOTSTRAP.city}
            </Text>
            <Text style={styles.overlayTitle}>
              {session.user.role === "passenger" ? `Hola, ${session.user.fullName}` : `Conductora: ${session.user.fullName}`}
            </Text>
            <Text style={styles.overlayCopy}>
              {session.user.role === "passenger"
                ? "Solicitud y tracking del viaje desde el primer viewport."
                : "Aceptacion real de solicitudes y control manual del viaje."}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {loading ? (
            <View style={styles.card}><ActivityIndicator color="#c54b23" /></View>
          ) : null}

          {session.user.role === "passenger" ? (
            <>
              <View style={styles.card}>
                <Text style={styles.heading}>Origen</Text>
                <Text style={styles.strong}>{origin?.label ?? "Cargando"}</Text>
                <Text style={styles.muted}>{origin?.address ?? "Preparando punto de recojo"}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.heading}>Destino</Text>
                {(passengerHome?.suggestedDestinations ?? DEFAULT_HOME_BOOTSTRAP.suggestedDestinations).map((item) => (
                  <Pressable
                    key={item.label}
                    onPress={() => {
                      setDestination(item);
                      setEstimate(null);
                    }}
                    style={[styles.choice, destination?.label === item.label && styles.choiceActive]}
                  >
                    <Text style={styles.strong}>{item.label}</Text>
                    <Text style={styles.muted}>{item.address}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.card}>
                <Text style={styles.heading}>Estimacion</Text>
                <Text style={styles.strong}>
                  {estimate ? `${estimate.currency} ${estimate.estimatedFare.toFixed(2)}` : "Pendiente"}
                </Text>
                <Text style={styles.muted}>
                  {estimate ? `${estimate.distanceKm} km - ${estimate.durationMinutes} min aprox.` : "Calcula antes de solicitar"}
                </Text>
                <Pressable onPress={handleEstimate} style={styles.altButton}>
                  <Text style={styles.altButtonText}>Calcular estimacion</Text>
                </Pressable>
                <Pressable onPress={handleRequestTrip} style={styles.button}>
                  <Text style={styles.buttonText}>Solicitar viaje</Text>
                </Pressable>
              </View>
              <View style={styles.card}>
                <Text style={styles.heading}>Estado</Text>
                <Text style={styles.strong}>{activeTrip?.status ?? "Sin viaje activo"}</Text>
                <Text style={styles.muted}>
                  {activeTrip?.driverName
                    ? `Conductora: ${activeTrip.driverName}`
                    : "Esperando asignacion"}
                </Text>
                {activeTrip ? (
                  <>
                    <Pressable onPress={handleReportIncident} style={styles.altButton}>
                      <Text style={styles.altButtonText}>Reportar incidencia</Text>
                    </Pressable>
                    <Pressable onPress={handleCancelTrip} style={styles.ghostButton}>
                      <Text style={styles.ghostButtonText}>Cancelar viaje</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.heading}>Resumen operativo</Text>
                <Text style={styles.strong}>Cola: {driverQueue.length}</Text>
                <Text style={styles.muted}>Activo: {activeTrip?.status ?? "Ninguno"}</Text>
                <Text style={styles.muted}>
                  Home: {driverHome?.queueSize ?? driverQueue.length} solicitudes visibles
                </Text>
              </View>
              {activeTrip ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.heading}>Viaje asignado</Text>
                    <Text style={styles.strong}>{activeTrip.passengerName}</Text>
                    <Text style={styles.muted}>
                      {activeTrip.origin.label} {"->"} {activeTrip.destination.label}
                    </Text>
                    <Text style={styles.muted}>Estado: {activeTrip.status}</Text>
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.heading}>Control manual</Text>
                    <Text style={styles.muted}>
                      Siguiente: {nextStatusForTrip(activeTrip) ?? "flujo completo"}
                    </Text>
                    <Pressable onPress={handleAdvanceTrip} style={styles.button}>
                      <Text style={styles.buttonText}>
                        {nextStatusForTrip(activeTrip)
                          ? `Marcar ${nextStatusForTrip(activeTrip)}`
                          : "Viaje completado"}
                      </Text>
                    </Pressable>
                    <Pressable onPress={handleReportIncident} style={styles.altButton}>
                      <Text style={styles.altButtonText}>Reportar incidencia</Text>
                    </Pressable>
                    <Pressable onPress={handleCancelTrip} style={styles.ghostButton}>
                      <Text style={styles.ghostButtonText}>Cancelar viaje</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.heading}>Solicitudes pendientes</Text>
                  {driverQueue.length === 0 ? (
                    <Text style={styles.muted}>No hay solicitudes nuevas.</Text>
                  ) : (
                    driverQueue.map((trip) => (
                      <View key={trip.id} style={styles.choice}>
                        <Text style={styles.strong}>{trip.passengerName}</Text>
                        <Text style={styles.muted}>
                          {trip.origin.label} {"->"} {trip.destination.label}
                        </Text>
                        <Text style={styles.muted}>{trip.estimate.currency} {trip.estimate.estimatedFare.toFixed(2)}</Text>
                        <Pressable onPress={() => handleAcceptTrip(trip.id)} style={styles.button}>
                          <Text style={styles.buttonText}>Aceptar solicitud</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              )}
            </>
          )}
          <View style={styles.card}>
            <Text style={styles.heading}>Sesion</Text>
            <Text style={styles.muted}>Rol: {session.user.role}</Text>
            <Text style={styles.muted}>Telefono: {session.user.phone}</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f0e8" },
  shell: { flex: 1, backgroundColor: "#f7f0e8" },
  auth: { flex: 1, justifyContent: "center", padding: 24 },
  mapWrap: { height: "56%", minHeight: 360 },
  map: { ...StyleSheet.absoluteFillObject },
  overlay: { margin: 18, padding: 18, borderRadius: 22, backgroundColor: "rgba(255,250,246,0.94)" },
  content: { padding: 18, paddingBottom: 32 },
  card: { marginBottom: 14, padding: 18, borderRadius: 20, backgroundColor: "#fffaf6" },
  row: { flexDirection: "row", gap: 12, marginBottom: 16 },
  chip: { flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: "#eadfd5", borderRadius: 14, alignItems: "center" },
  chipActive: { borderColor: "#c54b23", backgroundColor: "#fff1ea" },
  chipText: { color: "#5a534d", fontWeight: "700" },
  chipTextActive: { color: "#a53a17", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#e3d8ce", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff" },
  button: { marginTop: 12, minHeight: 50, borderRadius: 14, backgroundColor: "#c54b23", alignItems: "center", justifyContent: "center" },
  altButton: { marginTop: 12, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: "#c54b23", alignItems: "center", justifyContent: "center" },
  ghostButton: { marginTop: 12, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: "#d3b7aa", alignItems: "center", justifyContent: "center", backgroundColor: "#fff7f3" },
  buttonText: { color: "#fffaf6", fontWeight: "800", fontSize: 16 },
  altButtonText: { color: "#c54b23", fontWeight: "800", fontSize: 15 },
  ghostButtonText: { color: "#8d3e25", fontWeight: "800", fontSize: 15 },
  kicker: { color: "#c54b23", fontSize: 12, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase" },
  title: { marginTop: 8, color: "#1d1c1a", fontSize: 42, fontWeight: "800" },
  copy: { marginTop: 12, color: "#4d4741", fontSize: 18, lineHeight: 26 },
  overlayTitle: { marginTop: 6, color: "#1d1c1a", fontSize: 26, fontWeight: "800" },
  overlayCopy: { marginTop: 8, color: "#4d4741", fontSize: 15, lineHeight: 22 },
  heading: { color: "#1d1c1a", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  strong: { color: "#1d1c1a", fontSize: 17, fontWeight: "700", marginBottom: 6 },
  muted: { color: "#5a534d", fontSize: 14, marginBottom: 6 },
  choice: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "#f0e5dc", marginBottom: 10 },
  choiceActive: { borderColor: "#c54b23", backgroundColor: "#fff1ea" }
});
