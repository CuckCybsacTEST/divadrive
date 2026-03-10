import { SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SERVICE_NAME, TRIP_STATUSES } from "@diva-drive/domain";

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Text style={styles.eyebrow}>ANDROID FIRST BASE</Text>
        <Text style={styles.title}>{SERVICE_NAME}</Text>
        <Text style={styles.body}>
          La home real mostrara el mapa como primer viewport. Esta app ya nace
          conectada al contrato compartido de viajes.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Estados iniciales</Text>
          {TRIP_STATUSES.map((status) => (
            <Text key={status} style={styles.item}>
              {status}
            </Text>
          ))}
        </View>
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
    paddingHorizontal: 24,
    paddingVertical: 32,
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
  card: {
    marginTop: 28,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#fffaf6"
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
  }
});
