# Big Ass Fans

Esta integración controla los ventiladores de techo y las luces **Big Ass Fans** desde Gladys, en
la red local, sin cuenta en la nube: Haiku (series H/I, con o sin luz), i6, es6 y las luces Haiku L.
Habla el protocolo de la aplicación Big Ass Fans actual (puerto TCP 31415) y mantiene una conexión
abierta con cada ventilador: un cambio hecho con el mando o la aplicación aparece al instante en
Gladys.

> **Desarrollada sin el hardware: sus comentarios son bienvenidos.** La integración sigue el
> protocolo tal como lo documentan la biblioteca libre aiobafi6 y la integración `baf` de Home
> Assistant, y se prueba con un ventilador simulado, no con uno real. Si su ventilador se comporta
> de otro modo, abra una incidencia: https://github.com/guim31/gladys-bigassfans/issues

Esta integración no está afiliada a Big Ass Fans ni cuenta con su aprobación o patrocinio.

## Requisitos previos

- Gladys Assistant **5.1 o posterior**.
- Un ventilador o una luz Big Ass Fans configurado en la **aplicación Big Ass Fans actual**, en la
  misma red local que Gladys. Los Haiku necesitan el **firmware 3.0 o posterior**; los Haiku
  antiguos controlados por la aplicación SenseME no son compatibles.
- Gladys debe poder alcanzar el ventilador en el **puerto TCP 31415** (sin cortafuegos ni red de
  invitados entre ambos).
- Asigne al ventilador una dirección fija en su router (reserva DHCP): la integración sigue un
  cambio de dirección, pero una dirección fija evita una breve pérdida de control.

## Configuración

### Descubrimiento automático

Abra la integración y luego la pestaña **Descubrimiento**: los ventiladores que se anuncian en la
red (servicio mDNS `_api._tcp`, captado por Gladys para la integración) aparecen con el nombre que
tienen en la aplicación Big Ass Fans. Haga clic en **Añadir a Gladys** en cada uno que desee.

El botón **Buscar ventiladores** de la pantalla de configuración vuelve a buscar e indica lo que ha
encontrado: los ventiladores, su dirección y los que no responden.

### Añadir un ventilador por su dirección IP

Si no se encuentra un ventilador (otro segmento de red, mDNS filtrado por el router), introduzca su
dirección IP en **Direcciones IP de los ventiladores**, separadas por comas. La integración se
conecta a él directamente.

### Idioma

**Idioma de los nombres de funciones** fija los nombres de las funciones de los nuevos dispositivos
(Ventilador, Velocidad, Luz…) y el idioma de los mensajes de error: inglés, francés (por defecto),
alemán o español. Gladys fija un nombre al añadir el dispositivo; para cambiarlo después, cambie el
nombre de la función en Gladys.

## Dispositivos

Un dispositivo Gladys por ventilador, con el nombre de la aplicación Big Ass Fans. Solo se crea lo
que el dispositivo tiene.

### Ventilador

| Función                            | Qué hace                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **Ventilador**                     | Encendido / apagado.                                                                       |
| **Modo automático del ventilador** | El modo automático propio del ventilador (presencia, Auto Comfort). Desactivarlo lo apaga. |
| **Velocidad**                      | Las 7 velocidades del ventilador, 0 cuando está apagado. Una velocidad lo enciende.        |
| **Sentido de giro**                | Adelante (verano) o inverso (invierno), si el ventilador puede invertirse.                 |
| **Whoosh (brisa natural)**         | Hace variar la velocidad como una brisa natural.                                           |

Encendido, apagado y automático son las tres posiciones de un mismo modo: encender **Ventilador**
sale del modo automático, encender **Modo automático del ventilador** sale del simple encendido.
Fijar una velocidad con el ventilador en modo automático lo pasa a encendido a esa velocidad, como
la aplicación Big Ass Fans.

### Luz

Para los ventiladores con luz hacia abajo o hacia arriba y las luces Haiku L.

| Función                       | Qué hace                                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| **Luz**                       | Encendido / apagado.                                                |
| **Modo automático de la luz** | El modo automático propio de la luz (sigue al sensor de presencia). |
| **Brillo**                    | De 0 a 100 %, en los 16 niveles de la luz. Un brillo la enciende.   |
| **Temperatura de color**      | En kelvin, entre el blanco más cálido y el más frío de la luz.      |

### Sensores

Solo lectura, en los ventiladores que los tienen.

| Función         | Qué hace                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Temperatura** | La temperatura que mide el ventilador, en °C (ventiladores con Auto Comfort).                                     |
| **Humedad**     | La humedad relativa, en %, cuando el ventilador la mide.                                                          |
| **Presencia**   | Hay alguien en la habitación (Auto Comfort y firmware reciente). Vuelve a 0 tras unos 4,5 minutos sin movimiento. |

## Escenas

### Disparador: Ventilador cambiado fuera de Gladys

Se dispara cuando un ventilador se apaga, se enciende o se pone en automático **sin Gladys**: desde
su mando, su control de pared, la aplicación Big Ass Fans o por sí mismo (vuelta al modo
automático). Los cambios que hace Gladys nunca lo disparan: una escena que lo use no puede entrar en
bucle.

- **Ventilador**: un ventilador, o vacío para todos.
- **Nuevo modo**: **Apagado**, **Encendido**, **Automático**, varios, o vacío para cualquiera.
- Variables para las acciones siguientes: el nuevo modo (`off`, `on`, `auto`) y la velocidad (0 a
  7).

### Acción: Acelerar el ventilador un rato

Hace girar el ventilador a una velocidad (1 a 7, 7 por defecto) durante unos minutos (15 por
defecto, 720 como máximo) y luego lo deja como estaba: apagado, a su velocidad anterior o en modo
automático. Si alguien cambia el ventilador mientras tanto (velocidad, encendido, automático), se
queda como lo dejó. Una nueva acción sobre el mismo ventilador sustituye a la que está en curso y
sigue restableciendo el estado de antes de la primera. El final se devuelve como salida (fecha ISO).
Un reinicio de la integración durante ese tiempo cancela la vuelta al estado anterior.

### Ejemplos de escenas

- **Brisa matinal**: a las 7:00 entre semana, **Acelerar el ventilador un rato** en el dormitorio, a
  velocidad 3 durante 30 minutos.
- **Aire acondicionado apagado cuando el ventilador toma el relevo**: disparador **Ventilador
  cambiado fuera de Gladys** con **Nuevo modo** = **Encendido** → apagar el aire acondicionado de
  la habitación.
- **Invierno**: cuando la temperatura exterior baja de 10 °C, poner **Sentido de giro** en inverso y
  **Velocidad** en 1, para bajar el aire caliente del techo sin corrientes.
- **Luz con presencia**: cuando **Presencia** del ventilador del salón pasa a 1 después de la puesta
  de sol, encender **Luz** al 40 % de **Brillo**.

## Widget

La integración no ofrece widget de panel: la tarjeta de dispositivo de Gladys ya muestra y controla
cada función de un ventilador (encendido, control de velocidad, sentido, luz), y el impulso tiene su
sitio en las escenas.

## Cómo se actualizan los ventiladores

- Los ventiladores **envían** sus cambios por la conexión que la integración mantiene abierta: un
  cambio hecho con el mando aparece en menos de un segundo.
- La integración también **consulta todas las propiedades una vez por minuto** (como aiobafi6), lo
  que comprueba la conexión y recupera un cambio perdido; Gladys nunca consulta estos dispositivos
  por sí misma.
- Un valor que no cambia se vuelve a publicar cada 6 horas, para que Gladys nunca muestre «Sin
  valor reciente».
- La integración busca nuevos ventiladores y nuevas direcciones cada 15 minutos.
- Sin nube, sin cuenta y sin cuota: todo se queda en su red. Una conexión por ventilador.

## Solución de problemas

- **Ningún ventilador en la pestaña Descubrimiento**: compruebe que el ventilador funciona en la
  aplicación Big Ass Fans en la misma red y pulse **Buscar ventiladores**. Si el informe indica que
  el descubrimiento automático no está disponible, o si el ventilador está en otro segmento de red,
  introduzca su dirección IP.
- **«No responde»**: el ventilador está apagado en el disyuntor, ha cambiado de dirección o algo
  bloquea el puerto TCP 31415 entre Gladys y el ventilador. La integración vuelve a intentarlo sola y
  escribe una línea de registro cuando vuelve.
- **Un Haiku nunca aparece**: puede que aún tenga el firmware SenseME (anterior a 3.0). Actualícelo
  desde la aplicación Big Ass Fans.
- **Falta una función**: solo se crean las funciones que el ventilador anuncia. Un sensor que
  aparece más tarde (tras una actualización) se ofrece con un botón **Actualizar** en la pestaña
  Descubrimiento.
- **Registros detallados**: defina la variable de entorno `LOG_LEVEL=debug` en la integración para
  ver cada conexión y cada consulta.

## Límites

- Desarrollada y probada sin un ventilador real (véase arriba): las velocidades, los niveles de luz y
  los modos siguen a aiobafi6 y Home Assistant.
- El antiguo protocolo SenseME (Haiku con firmware anterior a 3.0, UDP) no es compatible.
- El modo reposo, las programaciones, las habitaciones, los ajustes de Auto Comfort (temperatura
  ideal, rango de velocidades), el modo eco, los indicadores LED y el pitido no están disponibles: el
  protocolo no ofrece modo reposo, y el resto son ajustes que se hacen una vez en la aplicación Big
  Ass Fans.
- Las revoluciones por minuto no se publican.
- Puede que algunos ventiladores solo acepten una conexión local a la vez: si otro sistema domótico
  está conectado al mismo ventilador, uno de los dos puede perderla.
- Un impulso en curso no se restablece tras un reinicio de la integración.

## Créditos

El conocimiento del protocolo procede de [aiobafi6](https://github.com/jfroy/aiobafi6) (jfroy) y de
la integración `baf` de Home Assistant (bdraco, jfroy), ambas bajo licencia Apache 2.0. Big Ass
Fans, Haiku, i6 y es6 son marcas de su propietario.
