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
  SERVICE_NAME,
  type AuthSession,
  type HomeBootstrap,
  type MapRegion,
  type SignInPayload
} from "@diva-drive/domain";

const API_BASE_URL = "http://10.0.2.2:4000";

const demoSessionFromPhone = (phone: string): AuthSession => ({
  accessToken: `demo-passenger-${phone.slice(-4) || "0000"}`,
  user: {
    id: `passenger-${phone.slice(-4) || "0000"}`,
    role: "passenger",
    fullName: "Pasajera Demo",
    phone
  }
});

const signInPassenger = async (payload: SignInPayload): Promise<AuthSession> => {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/sign-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("sign_in_failed");
    }

    return (await response.json()) as AuthSession;
  } catch {
    return demoSessionFromPhone(payload.phone);
  }
};

const loadPassengerHome = async (session: AuthSession): Promise<HomeBootstrap> => {
  try {
    const response = await fetch(`${API_BASE_URL}/home/passenger`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error("home_bootstrap_failed");
    }

    return (await response.json()) as HomeBootstrap;
  } catch {
    return DEFAULT_HOME_BOOTSTRAP;
  }
};

export default function App() {
  const [phone, setPhone] = useState("999111222");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [home, setHome] = useState<HomeBootstrap | null>(null);
  const [mapRegion, setMapRegion] = useState<MapRegion>(
    DEFAULT_HOME_BOOTSTRAP.mapRegion
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }

    let isMounted = true;

    const bootstrapHome = async () => {
      setLoading(true);

      try {
        const [bootstrap, locationPermission] = await Promise.all([
          loadPassengerHome(session),
          Location.requestForegroundPermissionsAsync()
        ]);

        if (!isMounted) {
          return;
        }

        setHome(bootstrap);
        setMapRegion(bootstrap.mapRegion);

        if (locationPermission.status === "granted") {
          const currentPosition = await Location.getCurrentPositionAsync({});

          if (!isMounted) {
            return;
          }

          setMapRegion((currentRegion) => ({
            ...currentRegion,
            latitude: currentPosition.coords.latitude,
            longitude: currentPosition.coords.longitude
          }));
        }
      } catch {
        if (isMounted) {
          Alert.alert(
            "No se pudo cargar la home",
            "Usaremos la configuracion base mientras completamos el backend."
          );
          setHome(DEFAULT_HOME_BOOTSTRAP);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void bootstrapHome();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleSignIn = async () => {
    if (phone.trim().length < 9) {
      Alert.alert("Telefono incompleto", "Ingresa un numero valido para continuar.");
      return;
    }

    setLoading(true);

    try {
      const nextSession = await signInPassenger({
        phone,
        role: "passenger"
      });

      setSession(nextSession);
    } catch {
      Alert.alert("No pudimos iniciar sesion", "Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.authScreen}>
          <Text style={styles.eyebrow}>DIVA DRIVE PASSENGER</Text>
          <Text style={styles.title}>{SERVICE_NAME}</Text>
          <Text style={styles.body}>
            Base de autenticacion inicial para arrancar el flujo de pasajero.
          </Text>

          <View style={styles.authCard}>
            <Text style={styles.label}>Telefono</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="999111222"
              keyboardType="phone-pad"
              autoCapitalize="none"
              style={styles.input}
            />

            <Pressable
              disabled={loading}
              onPress={handleSignIn}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                loading && styles.buttonDisabled
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#fffaf6" />
              ) : (
                <Text style={styles.primaryButtonText}>Continuar como pasajera</Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <View style={styles.mapShell}>
          <MapView style={styles.map} initialRegion={mapRegion} region={mapRegion}>
            <Marker
              coordinate={{
                latitude: mapRegion.latitude,
                longitude: mapRegion.longitude
              }}
              title="Tu ubicacion"
              description="Punto base para solicitar viaje"
            />
            <Marker
              coordinate={{
                latitude: mapRegion.latitude + 0.01,
                longitude: mapRegion.longitude + 0.008
              }}
              title="Zona segura"
              description="Cobertura inicial de DIVA DRIVE"
              pinColor="#c54b23"
            />
          </MapView>

          <View style={styles.topOverlay}>
            <Text style={styles.overlayEyebrow}>{home?.city ?? DEFAULT_HOME_BOOTSTRAP.city}</Text>
            <Text style={styles.overlayTitle}>Hola, {session.user.fullName}</Text>
            <Text style={styles.overlayBody}>
              El mapa es el primer viewport del flujo principal, tal como define
              la base del producto.
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.panelContent}
          showsVerticalScrollIndicator={false}
        >
          {loading || !home ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color="#c54b23" />
              <Text style={styles.loadingText}>Preparando tu home operativa...</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Acciones rapidas</Text>
                {home.quickActions.map((action) => (
                  <View key={action.id} style={styles.quickActionRow}>
                    <Text style={styles.quickActionLabel}>{action.label}</Text>
                    <Text style={styles.quickActionHint}>{action.hint}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Estado del viaje</Text>
                <Text style={styles.item}>
                  {home.activeTripStatus ?? "Sin viaje activo. Lista para solicitar."}
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Sesion</Text>
                <Text style={styles.item}>Rol: {session.user.role}</Text>
                <Text style={styles.item}>Telefono: {session.user.phone}</Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f7f0e8"
  },
  container: {
    flex: 1,
    backgroundColor: "#f7f0e8"
  },
  authScreen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: "center",
    backgroundColor: "#f7f0e8"
  },
  eyebrow: {
    color: "#c54b23",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12
  },
  title: {
    color: "#1d1c1a",
    fontSize: 42,
    fontWeight: "800",
    lineHeight: 44
  },
  body: {
    color: "#3f3a35",
    fontSize: 18,
    lineHeight: 28,
    marginTop: 16
  },
  authCard: {
    marginTop: 28,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#fffaf6"
  },
  label: {
    color: "#3f3a35",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8
  },
  input: {
    borderWidth: 1,
    borderColor: "#e3d8ce",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#1d1c1a",
    backgroundColor: "#ffffff"
  },
  primaryButton: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#c54b23"
  },
  primaryButtonText: {
    color: "#fffaf6",
    fontSize: 16,
    fontWeight: "800"
  },
  buttonPressed: {
    opacity: 0.9
  },
  buttonDisabled: {
    opacity: 0.6
  },
  mapShell: {
    height: "56%",
    minHeight: 360
  },
  map: {
    ...StyleSheet.absoluteFillObject
  },
  topOverlay: {
    marginTop: 18,
    marginHorizontal: 18,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(255, 250, 246, 0.94)"
  },
  overlayEyebrow: {
    color: "#c54b23",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase"
  },
  overlayTitle: {
    marginTop: 6,
    color: "#1d1c1a",
    fontSize: 26,
    fontWeight: "800"
  },
  overlayBody: {
    marginTop: 8,
    color: "#4d4741",
    fontSize: 15,
    lineHeight: 22
  },
  panelContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32
  },
  card: {
    marginBottom: 14,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#fffaf6"
  },
  loadingCard: {
    marginBottom: 14,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#fffaf6",
    alignItems: "center",
    gap: 12
  },
  loadingText: {
    color: "#4d4741",
    fontSize: 15
  },
  cardTitle: {
    color: "#1d1c1a",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12
  },
  item: {
    color: "#3f3a35",
    fontSize: 16,
    marginBottom: 8
  },
  quickActionRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0e5dc"
  },
  quickActionLabel: {
    color: "#1d1c1a",
    fontSize: 16,
    fontWeight: "700"
  },
  quickActionHint: {
    color: "#5a534d",
    fontSize: 14,
    marginTop: 4
  }
});
