# My Best DataBase

**Sistema Gestor de Bases de Datos MySQL con interfaz web**

> Proyecto académico desarrollado para la asignatura de Bases de Datos.
> Institución: *[Nombre de la institución]* · Periodo: *[Semestre / Año]*

![Node.js](https://img.shields.io/badge/Node.js-Express_4-339933?logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-mysql2-4479A1?logo=mysql&logoColor=white)
![JavaScript](https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JS-F7DF1E?logo=javascript&logoColor=black)
![Versión](https://img.shields.io/badge/versión-1.0.0-blue)

---
Capturas del programa
<img width="1919" height="953" alt="image" src="https://github.com/user-attachments/assets/b95f427d-5c30-48ff-a2a1-71b125b9d36b" />
<img width="1919" height="951" alt="image" src="https://github.com/user-attachments/assets/0d7cea6a-cda5-41d1-8a75-c4e96877d7be" />
<img width="1919" height="950" alt="image" src="https://github.com/user-attachments/assets/1403311c-15dc-42b4-9350-dc0efdefed65" />
<img width="454" height="487" alt="image" src="https://github.com/user-attachments/assets/ab0d1449-be5c-4c96-8bbd-7ed604f2e917" />

---

## Tabla de contenido

1. [Resumen](#1-resumen)
2. [Planteamiento del problema](#2-planteamiento-del-problema)
3. [Objetivos](#3-objetivos)
4. [Alcance del sistema](#4-alcance-del-sistema)
5. [Funcionalidades](#5-funcionalidades)
6. [Arquitectura](#6-arquitectura)
7. [Tecnologías empleadas](#7-tecnologías-empleadas)
8. [Requisitos previos](#8-requisitos-previos)
9. [Instalación y configuración](#9-instalación-y-configuración)
10. [Guía de uso](#10-guía-de-uso)
11. [Interfaz de programación (API REST)](#11-interfaz-de-programación-api-rest)
12. [Estructura del repositorio](#12-estructura-del-repositorio)
13. [Consideraciones de seguridad](#13-consideraciones-de-seguridad)
14. [Limitaciones conocidas](#14-limitaciones-conocidas)
15. [Trabajo futuro](#15-trabajo-futuro)
16. [Autores](#16-autores)
17. [Licencia](#17-licencia)
18. [Referencias](#18-referencias)

---

## 1. Resumen

*My Best DataBase* es un sistema gestor de bases de datos de tipo cliente para servidores MySQL, implementado como aplicación web con un servidor Node.js/Express y una interfaz construida con HTML, CSS y JavaScript sin *frameworks*. La herramienta, inspirada en entornos como MySQL Workbench, integra en un solo espacio de trabajo —denominado *Studio*— un editor SQL con resaltado de sintaxis y autocompletado, un explorador de esquemas, un diagrama Entidad-Relación generado automáticamente, un constructor visual de consultas, un diseñador gráfico de bases de datos y tablas, la edición de registros directamente sobre la cuadrícula de resultados, así como mecanismos de respaldo, restauración, exportación y conversión de datos.

El proyecto tiene como propósito aplicar de manera práctica los conceptos del modelo relacional, el lenguaje SQL (DDL y DML), la integridad referencial y el control transaccional estudiados en la asignatura, en una herramienta funcional orientada al aprendizaje.

## 2. Planteamiento del problema

La administración de bases de datos relacionales mediante la línea de comandos exige un dominio previo de la sintaxis SQL y dificulta la comprensión visual de las relaciones entre entidades. Las herramientas profesionales existentes resuelven esta necesidad, pero su cantidad de opciones y su curva de aprendizaje pueden resultar excesivas en un contexto formativo.

Se identificó, por tanto, la necesidad de una herramienta que reuniera en un entorno único y accesible las operaciones más frecuentes —consulta, diseño de estructuras, visualización del esquema y manejo de datos—, mostrando en todo momento el código SQL que cada acción genera, de modo que la interfaz gráfica funcione también como recurso didáctico y no como sustituto del lenguaje.

## 3. Objetivos

### 3.1 Objetivo general

Desarrollar un sistema gestor de bases de datos con interfaz web que permita administrar, consultar, diseñar y visualizar bases de datos relacionales alojadas en un servidor MySQL.

### 3.2 Objetivos específicos

- Implementar un módulo de autenticación de usuarios con verificación por correo electrónico.
- Construir un editor SQL con resaltado de sintaxis, autocompletado, múltiples pestañas y ejecución total o parcial de *scripts*.
- Generar diagramas Entidad-Relación a partir de los metadatos de `information_schema` (columnas, llaves primarias y foráneas).
- Permitir la creación y modificación de bases de datos y tablas mediante formularios, con vista previa en vivo de las sentencias DDL resultantes.
- Proveer un constructor visual de consultas `SELECT` con inferencia de `JOIN` a partir de las llaves foráneas.
- Habilitar la edición de registros desde la cuadrícula de resultados, aplicando los cambios dentro de una transacción.
- Incorporar mecanismos de protección ante operaciones destructivas.
- Ofrecer funciones de respaldo, restauración, exportación y conversión de formatos de datos.

## 4. Alcance del sistema

El sistema está orientado a fines académicos y a la administración de bases de datos de pequeña y mediana escala. Comprende la conexión a un servidor MySQL (o MariaDB compatible) a la vez, la ejecución de sentencias SQL estándar, el diseño estructural de esquemas y su representación gráfica.

Quedan fuera del alcance de la versión actual la administración de usuarios y privilegios del servidor MySQL, la replicación, la programación de respaldos automáticos y el monitoreo de rendimiento del servidor.

## 5. Funcionalidades

### 5.1 Autenticación de usuarios

- Registro en dos pasos: el sistema envía al correo del usuario un código de verificación de seis dígitos con vigencia de diez minutos.
- Almacenamiento de contraseñas cifradas mediante *bcrypt*.
- Inicio de sesión con emisión de un *token* JWT con vigencia de ocho horas.

### 5.2 Editor SQL

| Característica | Descripción |
|---|---|
| Resaltado de sintaxis | Coloreado de palabras reservadas, cadenas, números y comentarios. |
| Autocompletado | Sugerencias de palabras clave, tablas y columnas mientras se escribe. |
| Pestañas múltiples | Cada pestaña conserva su propio *script* y resultado; se pueden renombrar y se recuperan al volver a iniciar sesión. |
| Ejecución | Ejecución del *script* completo (`Ctrl + Enter` / `F5`) o solo del texto seleccionado (`Ctrl + Shift + Enter`). |
| Múltiples sentencias | Soporte para *scripts* con varias sentencias y para la directiva `DELIMITER` (disparadores y procedimientos almacenados). |
| Consola de registros | Bitácora en tiempo real con el resultado, las filas afectadas y el tiempo de ejecución de cada sentencia. |

### 5.3 Explorador de esquemas

Visualización de las bases de datos del servidor y de sus tablas, con opción de eliminar bases de datos previa confirmación. Las bases de datos del sistema (`mysql`, `sys`, `information_schema`, `performance_schema`) están protegidas.

### 5.4 Diagrama Entidad-Relación

Generación automática del diagrama del esquema seleccionado a partir de `information_schema.COLUMNS` y `information_schema.KEY_COLUMN_USAGE`. Cada entidad muestra sus atributos, tipos de dato, llaves primarias y foráneas, y las relaciones se trazan conforme a las restricciones de integridad referencial definidas.

### 5.5 Diseñador visual de bases de datos y tablas

- Creación de bases de datos con selección de juego de caracteres (*charset*) y *collation*.
- Creación de tablas definiendo columnas, tipos de dato, longitud y atributos (`PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `AUTO_INCREMENT`, `UNSIGNED`, `DEFAULT`, comentarios).
- Definición de llaves foráneas con las acciones `ON DELETE` y `ON UPDATE`.
- Modificación de tablas existentes: el sistema compara la estructura original con la editada y genera únicamente las sentencias `ALTER TABLE` necesarias.
- Vista previa en vivo del SQL generado. El mismo módulo (`ddl-builder.js`) se emplea en el navegador y en el servidor, lo que garantiza que el código mostrado sea exactamente el que se ejecuta.

### 5.6 Constructor visual de consultas

Construcción de sentencias `SELECT` sin escribir código: selección de tablas y columnas, `JOIN` inferidos de las llaves foráneas (o, en su defecto, por convención de nombres, p. ej. `usuario_id → usuarios.id`), condiciones `WHERE` con operadores `AND`/`OR`, `ORDER BY`, `DISTINCT` y `LIMIT`. La consulta resultante puede enviarse al editor SQL.

### 5.7 Cuadrícula de resultados

- **Filtros por columna** según el tipo de dato (numérico, texto, fecha, `NULL`) y ordenamiento ascendente o descendente; el sistema reescribe la consulta con las cláusulas `WHERE` y `ORDER BY` correspondientes.
- **Edición de datos**, disponible cuando el resultado proviene de una sola tabla e incluye su llave primaria: modificación de celdas, inserción y eliminación de filas. Los cambios permanecen pendientes hasta su revisión y se aplican como sentencias `UPDATE`, `INSERT` y `DELETE` dentro de una **transacción**; si alguna falla, se ejecuta `ROLLBACK`.

### 5.8 Exportación, respaldo y conversión

| Módulo | Descripción |
|---|---|
| Exportación de resultados | CSV, JSON, Excel (`.xlsx`), sentencias `INSERT` y copia al portapapeles. |
| Respaldo | Generación de un archivo `.sql` con la estructura (`CREATE TABLE`), los datos (`INSERT`), vistas, disparadores y procedimientos almacenados de una base de datos. |
| Restauración | Ejecución de un archivo `.sql`, sentencia por sentencia, sobre una base de datos existente o nueva. |
| Conversor de datos | JSON → SQL / Markdown; CSV → SQL; SQL (`INSERT`) → JSON / CSV / Excel; Excel → SQL. Incluye un analizador léxico-sintáctico de sentencias `INSERT` que reporta errores con línea y columna. |

### 5.9 Protección ante operaciones peligrosas

Antes de ejecutar un *script*, el sistema analiza su nivel de riesgo:

- **Riesgo alto** (`DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DELETE` o `UPDATE` sin `WHERE`): el usuario debe escribir la palabra `CONFIRMAR`.
- **Riesgo medio** (`ALTER TABLE ... DROP`, `RENAME`, `DROP VIEW`, entre otras): se solicita confirmación con un clic.

Este “modo seguro” puede desactivarse desde la barra de herramientas; sin embargo, el servidor mantiene una segunda capa de validación que impide en todo caso eliminar las bases de datos del sistema.

### 5.10 Interfaz

Tema claro y oscuro con persistencia de la preferencia del usuario y respeto a la configuración del sistema operativo.

## 6. Arquitectura

El sistema sigue una arquitectura cliente-servidor de tres capas:

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA DE PRESENTACIÓN  (navegador · public/)                │
│  login.html · studio.html · módulos JS · hojas de estilo    │
│  Editor SQL · Diagrama ER · Constructor · Diseñador · Grid  │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP / JSON (fetch)
┌──────────────────────────▼──────────────────────────────────┐
│  CAPA DE LÓGICA  (Node.js + Express · server.js, routes/)   │
│  Autenticación (JWT, bcrypt, OTP por correo)                │
│  Ejecución de consultas · lectura de metadatos              │
│  Diseñador (DDL) · edición transaccional · respaldo         │
│  Validación de seguridad del lado del servidor              │
└──────────────────────────┬──────────────────────────────────┘
                           │  mysql2 (una conexión por petición)
┌──────────────────────────▼──────────────────────────────────┐
│  CAPA DE DATOS                                              │
│  Servidor MySQL / MariaDB  ·  data/users.json (usuarios)    │
└─────────────────────────────────────────────────────────────┘
```

**Módulos compartidos.** Los archivos `sql-utils.js`, `ddl-builder.js` y `grid-sql.js` se ejecutan tanto en el navegador como en el servidor. Esta decisión de diseño asegura que el análisis de sentencias y la generación de SQL produzcan resultados idénticos en ambos extremos: el usuario visualiza exactamente el código que el servidor valida y ejecuta.

**Gestión de conexiones.** Cada petición abre una conexión con los parámetros proporcionados por el cliente y la cierra al concluir, evitando conexiones persistentes en el servidor.

## 7. Tecnologías empleadas

| Componente | Tecnología |
|---|---|
| Entorno de ejecución | Node.js |
| Servidor web / API | Express 4 |
| Controlador de base de datos | mysql2 |
| Autenticación | jsonwebtoken (JWT), bcryptjs |
| Envío de correo | Nodemailer (Gmail) |
| Hojas de cálculo | SheetJS (xlsx) |
| Variables de entorno | dotenv |
| Interfaz de usuario | HTML5, CSS3 y JavaScript (sin *frameworks*) |
| Sistema gestor de base de datos | MySQL 8 (compatible con MariaDB) |
| Herramientas de desarrollo | nodemon |

## 8. Requisitos previos

- [Node.js](https://nodejs.org/) versión 18 o superior y npm.
- Servidor MySQL 8 (o MariaDB) en ejecución y accesible.
- Un usuario de MySQL con privilegios suficientes sobre las bases de datos a administrar.
- Una cuenta de Gmail con **contraseña de aplicación** para el envío de los códigos de verificación.

## 9. Instalación y configuración

1. **Obtener el código fuente.**

   ```bash
   git clone https://github.com/CalixtoIsaac/My-Best-DataBase
   cd My-Best-DataBase
   ```

2. **Instalar las dependencias.**

   ```bash
   npm install
   ```

3. **Configurar las variables de entorno.** Copiar `.env.example` como `.env` en la raíz del proyecto y completar los valores:

   ```env
   PORT=3000
   JWT_SECRET=una_cadena_larga_y_aleatoria
   EMAIL_USER=cuenta@gmail.com
   EMAIL_PASS_APP=contraseña_de_aplicacion_de_gmail
   ```

   | Variable | Descripción |
   |---|---|
   | `PORT` | Puerto del servidor web (por defecto, `3000`). |
   | `JWT_SECRET` | Clave para firmar los *tokens* de sesión. |
   | `EMAIL_USER` | Cuenta de Gmail desde la que se envían los códigos. |
   | `EMAIL_PASS_APP` | Contraseña de aplicación de dicha cuenta. |

   > El archivo `.env` está excluido del control de versiones mediante `.gitignore` y no debe publicarse.

4. **Iniciar el servidor.**

   ```bash
   npm start        # modo normal
   npm run dev      # modo desarrollo (reinicio automático con nodemon)
   ```

5. **Acceder a la aplicación** en `http://localhost:3000`.

## 10. Guía de uso

1. **Registro e inicio de sesión.** Capture su nombre y correo, introduzca el código recibido y defina una contraseña. Posteriormente inicie sesión con sus credenciales.
2. **Conexión al servidor.** En el *Studio*, configure la conexión (host, puerto, usuario y contraseña de MySQL).
3. **Exploración.** Seleccione una base de datos en el panel lateral para consultar sus tablas.
4. **Consultas.** Redacte sentencias en el **Editor SQL** y ejecútelas con `Ctrl + Enter`; los resultados aparecen en la cuadrícula y los mensajes en la consola.
5. **Diagrama ER.** Abra la pestaña **Diagrama ER** para visualizar las entidades y relaciones del esquema activo.
6. **Constructor de consultas.** En la pestaña **Constructor de Consultas**, seleccione tablas, columnas y condiciones; envíe el resultado al editor.
7. **Diseño de estructuras.** Utilice el diseñador para crear bases de datos o tablas, o para modificar una tabla existente, revisando el SQL generado antes de aplicarlo.
8. **Edición, exportación y respaldo.** Edite registros desde la cuadrícula, exporte resultados o genere y restaure respaldos `.sql` desde la barra de herramientas.

*[Se recomienda incluir en esta sección capturas de pantalla de cada módulo.]*

## 11. Interfaz de programación (API REST)

Todas las rutas reciben y devuelven JSON. Las rutas de base de datos requieren el objeto `connectionConfig` en el cuerpo de la petición.

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/send-code` | Envía el código de verificación al correo. |
| `POST` | `/api/auth/register` | Verifica el código y registra al usuario. |
| `POST` | `/api/auth/login` | Autentica al usuario y devuelve un *token* JWT. |
| `GET` | `/api/health` | Estado del servicio. |
| `POST` | `/api/query` | Ejecuta una o varias sentencias SQL. |
| `POST` | `/api/databases` | Lista las bases de datos del servidor. |
| `DELETE` | `/api/databases` | Elimina una base de datos (excepto las del sistema). |
| `POST` | `/api/tables` | Lista las tablas de una base de datos. |
| `POST` | `/api/schema` | Devuelve columnas y relaciones para el diagrama ER. |
| `POST` | `/api/designer/charsets` | Juegos de caracteres y *collations* disponibles. |
| `POST` | `/api/designer/create-database` | Crea una base de datos. |
| `POST` | `/api/designer/create-table` | Crea una tabla. |
| `POST` | `/api/designer/alter-table` | Aplica modificaciones a una tabla. |
| `POST` | `/api/designer/table-structure` | Devuelve la estructura de una tabla. |
| `POST` | `/api/grid/apply` | Aplica cambios de la cuadrícula en una transacción. |
| `POST` | `/api/backup` | Genera el respaldo `.sql` de una base de datos. |
| `POST` | `/api/restore` | Ejecuta un archivo `.sql` de restauración. |

## 12. Estructura del repositorio

```
My-Best-DataBase/
├── server.js                # Punto de entrada: servidor Express y rutas principales
├── package.json             # Metadatos, scripts y dependencias
├── .env                     # Variables de entorno (no versionado)
├── routes/
│   ├── auth.js              # Registro, verificación por correo e inicio de sesión
│   └── tools.js             # Diseñador, edición del grid, respaldo y restauración
├── data/
│   └── users.json           # Registro local de usuarios (contraseñas cifradas)
└── public/
    ├── login.html           # Pantalla de acceso y registro
    ├── studio.html          # Espacio de trabajo principal
    ├── css/                 # Estilos: tema, login, studio, conversor, constructor
    └── js/
        ├── app.js           # Controlador principal de la interfaz
        ├── auth.js          # Sesión y navegación del lado del cliente
        ├── editor-tabs.js   # Pestañas múltiples del editor
        ├── sql-utils.js     # División de scripts y análisis de riesgo (compartido)
        ├── safety.js        # Confirmación de operaciones peligrosas
        ├── designer.js      # Diseñador visual de bases de datos y tablas
        ├── ddl-builder.js   # Generador de DDL (compartido)
        ├── query-builder.js # Constructor visual de consultas
        ├── result-grid.js   # Filtros y edición en la cuadrícula
        ├── grid-sql.js      # Generador de SQL para el grid (compartido)
        ├── export.js        # Exportación de resultados
        ├── backup.js        # Respaldo y restauración
        ├── data-converter.js# Núcleo del conversor de formatos
        ├── converter-ui.js  # Interfaz del conversor
        ├── theme.js         # Tema claro / oscuro
        └── ui-kit.js        # Componentes de interfaz reutilizables
```

## 13. Consideraciones de seguridad

- Las contraseñas de los usuarios se almacenan cifradas con *bcrypt* (factor de costo 10).
- La sesión se gestiona mediante *tokens* JWT con expiración de ocho horas, y **toda la API** (salvo el registro, el inicio de sesión y `/api/health`) exige un *token* válido.
- La clave `JWT_SECRET` es obligatoria: en producción el servidor no arranca sin ella.
- Límite de intentos en el inicio de sesión, el envío de códigos y el registro; código de verificación generado con `crypto` y máximo 5 intentos por código.
- El inicio de sesión responde con un mensaje único (*"Correo o contraseña incorrectos"*) para no revelar qué correos están registrados.
- La contraseña de MySQL se guarda solo durante la sesión del navegador (`sessionStorage`), nunca de forma permanente.
- La API no acepta peticiones de otros orígenes (CORS cerrado) y envía cabeceras contra *clickjacking* y *MIME sniffing*.
- Las operaciones destructivas se validan tanto en el cliente como en el servidor.
- La edición desde la cuadrícula identifica cada fila por su llave primaria y se ejecuta de forma transaccional, lo que preserva la consistencia ante fallos o modificaciones concurrentes.
- La interfaz escapa el contenido HTML al mostrar nombres y datos (incluidos los nombres de bases de datos, tablas y columnas del árbol lateral y del diagrama ER), a fin de prevenir inyección de código en la página.

## 14. Limitaciones conocidas

- Los usuarios de la aplicación se almacenan en un archivo JSON local, adecuado para un entorno académico pero no para un despliegue con múltiples usuarios concurrentes.
- Los códigos de verificación se guardan en memoria, por lo que se pierden si el servidor se reinicia.
- Por seguridad, la contraseña de MySQL no se conserva al cerrar el navegador: el Studio la solicita de nuevo.
- El limitador de intentos y los códigos de verificación viven en memoria y se reinician con el servidor.
- El sistema está diseñado para ejecutarse de forma local; su exposición a una red pública requeriría medidas adicionales (HTTPS mediante un proxy inverso y `NODE_ENV=production`).

## 15. Trabajo futuro

- **Consultas en lenguaje natural.** Integración de un modelo de inteligencia artificial que traduzca solicitudes expresadas en lenguaje natural a sentencias `SELECT`, las cuales se mostrarían al usuario para su revisión antes de ejecutarse.
- Migración del registro de usuarios a una base de datos relacional.
- Guardar la conexión a MySQL del lado del servidor, asociada a la sesión.
- Empaquetado como aplicación de escritorio.
- Exportación del diagrama Entidad-Relación como imagen.

## 16. Autores

| Nombre | Rol |
|---|---|
| Calixto Isaac Galeana Medrano | Desarrollo y documentación |
| Kevin Ramos  | UI/UX y LOGIN |
| David | Design Thinking y Scrum  |

**Docente:** *[Jose Manuel Martínez García]*
**Asignatura:** Bases de Datos

## 17. Licencia

Este proyecto se distribuye con fines exclusivamente académicos.

## 18. Referencias

- Elmasri, R., & Navathe, S. B. (2016). *Fundamentals of Database Systems* (7th ed.). Pearson.
- Silberschatz, A., Korth, H. F., & Sudarshan, S. (2019). *Database System Concepts* (7th ed.). McGraw-Hill.
- Oracle Corporation. (s. f.). *MySQL 8.0 Reference Manual*. https://dev.mysql.com/doc/refman/8.0/en/
- OpenJS Foundation. (s. f.). *Express — Node.js web application framework*. https://expressjs.com/
- Sidorares. (s. f.). *mysql2: MySQL client for Node.js*. https://github.com/sidorares/node-mysql2
