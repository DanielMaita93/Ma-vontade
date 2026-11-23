# ⚡ Ma Vontade — Control Semanal de Guild (GitHub Pages)

Aplicación web **100% compatible con GitHub Pages** (Opción 1: interfaz web conectada directo a GitHub) para llevar el control semanal de metas, entradas/salidas de jugadores y penalizaciones (regla de 3 strikes).

## Características
- **Vista de Miembros (Pública):** Sin contraseña. Lee automáticamente los datos más recientes desde tu repositorio de GitHub (`raw.githubusercontent.com`) para que todos vean las actualizaciones al instante.
- **Panel Líder / Vice-Líder (Protegido con contraseña):**
  - Acepta directamente tu archivo **`.json`** con la estructura:
    ```json
    {
      "guild": "Ma Vontade",
      "exportedAt": "2026-11-23 16:45:45",
      "members": [
        {
          "name": "Braya",
          "rank": "the Leader",
          "level": 501,
          "status": "online",
          "lastLogin": "",
          "points": 4,
          "contribution": 0
        }
      ]
    }
    ```
  - También acepta archivos Excel/CSV (`.xlsx`, `.xls`, `.csv`, `.tsv`) con las mismas columnas.
  - **Al cargar el archivo** detecta automáticamente la fecha (`exportedAt`), jugadores **nuevos**, jugadores que **salieron**, quiénes cumplieron la meta y quiénes recibirán penalización (con opción de perdonar o editar el motivo antes de publicar).
  - **Regla de 3 Penalizaciones:** guarda cada falta con la **fecha de la semana** y resalta en rojo con etiqueta `🚫 3/3 EXCLUIDO` a quien acumule 3 faltas.
  - **Botón `☁️ Guardar y Publicar en GitHub`:** actualiza `data.json` directamente en tu repositorio sin salir de la web.

## Claves iniciales (cámbialas en Configuración)
- **Líder:** `leader123`
- **Vice-Líder:** `vice123`

---

## Cómo subirlo a GitHub Pages (Opción 1)

1. Crea un repositorio público en GitHub (ej. `ma-vontade-guild`).
2. Sube estos 4 archivos a la raíz del repositorio:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `data.json`
3. Ve a **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)` → **Save**.
4. Espera ~1 minuto y abre tu web en `https://TU-USUARIO.github.io/ma-vontade-guild/`.

### Configurar publicación instantánea para Líder y Vice-Líder
1. En GitHub ve a **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. En **Repository access**, elige **Only select repositories** y selecciona tu repo `ma-vontade-guild`.
3. En **Repository permissions → Contents**, selecciona **Read and write** y crea el token.
4. En tu web, entra a **🔒 Panel Líder / Vice → ⚙️ Configuración y GitHub**, verifica tu usuario/repo (si ya estás en GitHub Pages se autocompletan solos), pega el token y pulsa **Guardar conexión**.
5. **Flujo semanal:**
   - Entra a **📤 Cargar Archivo Semanal** y arrastra tu `.json` (o Excel).
   - Revisa el resumen inmediato (quiénes cumplieron, nuevos, salidas y strikes).
   - Pulsa **☁️ Guardar y Publicar en GitHub**.
   - ¡Listo! Todos los miembros verán la data actualizada al instante.
